// 待办同步引擎单测（node --test）
import { test } from 'node:test';
import assert from 'node:assert';
import { Store } from '../src/sync/store.js';
import { TodoItemType, REAL_TYPES, trimTodo, pushTodoChange, pullTodos } from '../src/sync/todo-sync.js';

test('TodoItemType 枚举值', () => {
  assert.strictEqual(TodoItemType.Undo, 0);
  assert.strictEqual(TodoItemType.Complete, 1);
  assert.strictEqual(TodoItemType.GroupLine, 2);
  assert.deepStrictEqual(REAL_TYPES, [0, 1]);
});

test('trimTodo: content→contentToDo + 剔除 UI 字段', () => {
  const t = trimTodo({
    guid: 'g1', content: '买牛奶', type: 0, sort: 1,
    children: [], isEnterEdit: false, dateValue: '今天', reminderTimeStr: 'x',
  });
  assert.strictEqual(t.contentToDo, '买牛奶');
  assert.strictEqual('content' in t, false);
  assert.strictEqual('children' in t, false);
  assert.strictEqual('isEnterEdit' in t, false);
  assert.strictEqual('dateValue' in t, false);
  assert.strictEqual(t.dirty, 1);
});

test('trimTodo: 分隔线虚拟行不同步（返回 null）', () => {
  assert.strictEqual(trimTodo({ guid: 'g2', type: TodoItemType.GroupLine }), null);
  assert.strictEqual(trimTodo({ guid: 'g3', type: TodoItemType.CompleteLine }), null);
});

test('Store: saveTodo 游标 = updateTime', () => {
  const s = new Store(':memory:');
  s.saveTodo({ guid: 't1', content: '任务A', type: 0, sort: 1 });
  assert.ok(s.todoMaxUpdateTime() > 0);
  const t = s.getTodo('t1');
  assert.strictEqual(t.contentToDo, '任务A');
  assert.strictEqual(t.dirty, 1);
  s.close();
});

test('Store: listTodos 只返回真实待办 type IN (0,1)', () => {
  const s = new Store(':memory:');
  s.saveTodo({ guid: 'r1', content: '真实', type: 0, sort: 1 });
  s.upsertTodo({ guid: 'v1', contentToDo: '分隔线', type: 2, sort: 2, deleted: 1, dirty: 0 });
  const list = s.listTodos();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].guid, 'r1');
  s.close();
});

test('Store: deleteTodoSoft → deleted=-1 + ex1 清空', () => {
  const s = new Store(':memory:');
  s.saveTodo({ guid: 'd1', content: '删我', type: 0, sort: 1, ex1: 'x' });
  s.deleteTodoSoft('d1');
  const t = s.getTodo('d1');
  assert.strictEqual(t.deleted, -1);
  assert.strictEqual(t.dirty, 1);
  assert.strictEqual(t.ex1, '');
  s.close();
});

test('pushTodoChange: 事件驱动先刷游标→推送→回写', async () => {
  const calls = [];
  const fakeApi = {
    getSyncState: async () => { calls.push('state'); return { updateCount: 500 }; },
    createTodo: async (luc, syncUp) => { calls.push(['create', luc, syncUp.length]); return [{ guid: 'g1', updateSequenceNum: 999 }]; },
    updateTodo: async (luc, syncUp) => { calls.push(['update', luc]); return [{ guid: 'g1', updateSequenceNum: 1001 }]; },
    deleteTodo: async (luc, del) => { calls.push(['delete', luc, del]); return [{ guid: 'g1', updateSequenceNum: 1002 }]; },
  };
  let usn = 0;
  const setUsn = v => { usn = v; };
  await pushTodoChange(fakeApi, { action: 'create', payload: [{ guid: 'g1', content: 'x', type: 0 }] }, () => usn, setUsn);
  assert.deepStrictEqual(calls[0], 'state');
  assert.deepStrictEqual(calls[1], ['create', 500, 1]);
  assert.strictEqual(usn, 999);
  await pushTodoChange(fakeApi, { action: 'update', payload: [{ guid: 'g1', content: 'y', type: 0 }] }, () => usn, setUsn);
  assert.strictEqual(usn, 1001);
  await pushTodoChange(fakeApi, { action: 'delete', payload: ['g1'] }, () => usn, setUsn);
  assert.strictEqual(usn, 1002);
});

test('pullTodos: 递归续拉直到 chunkHighUsn', async () => {
  let usn = 0;
  let n = 0;
  const fakeApi = {
    fetchSyncChunk: async ({ afterUsn }) => {
      n++;
      const updateCount = afterUsn + 100;
      return { todos: [], updateCount, chunkHighUsn: n < 3 ? updateCount - 1 : updateCount };
    },
  };
  await pullTodos(fakeApi, () => usn, v => { usn = v; }, async () => {});
  assert.strictEqual(n, 3);
  assert.strictEqual(usn, 300);
});

test('Store: applyServerTodos 覆盖 + 清 dirty', () => {
  const s = new Store(':memory:');
  s.saveTodo({ guid: 's1', content: '本地旧', type: 0, sort: 1 });
  s.applyServerTodos({
    todos: [{ guid: 's1', contentToDo: '云端新', type: 0, sort: 1, updateTime: 999 }],
    todoCategories: [{ guid: 'c1', name: '工作', color: 1, colorIndex: 0 }],
    delete: { todos: [] },
  });
  const t = s.getTodo('s1');
  assert.strictEqual(t.contentToDo, '云端新');
  assert.strictEqual(t.dirty, 0);
  assert.strictEqual(s.listTodoCategories().length, 1);
  s.close();
});
