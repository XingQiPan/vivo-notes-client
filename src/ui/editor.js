// TinyMCE 编辑器装配 —— 插件列表、custom_elements、限制参数全部照抄
// app-modules-note.js @1280635（vivo 笔记真实 init 配置）。
// 去掉的只有云端相关：filemanager 上传、copypasteproxy、vnoteaipanel 的后端调用。
window.__editorReady = false;

(function () {
  if (!window.tinymce) { console.error('[editor] tinymce.min.js 未加载'); return; }

  const PLUGINS = [
    // 第一组：基础行为
    'vnoteshortscut vnotesecurity selectioncontrol vnotebase vnotecontextmenu wordcountlimit ' +
    'copypasteproxy vnotefilter preventdelete dropfile forbiddentool needsort editorskins pagezoom ' +
    'vnoteformatpainter scrollbar',
    // 第二组：内容块
    'vnoteconfig vnoteunknown vnotetable vnoteimage vnoteaudio layout title divider symbol vnotecolor ' +
    'vnotelists vnotefont vnotelocation vnoteshorthand vnotert vnotehdw vnotevideo vnotedoc vnoteaipanel ' +
    'vnoteindent vnoteheading',
    // 第三组：标准
    'autolink paste lists link table code fullscreen searchreplace charmap emoticons preview help',
  ].join(' ');

  // 真实 custom_elements（vnote 私有标签）
  const CUSTOM_ELEMENTS =
    'vnote-font,vnote-color,vnote-heading,vnote-list,vnote-indent,vnote-table,vnote-image,' +
    'vnote-audio,vnote-video,vnote-doc,vnote-location,vnote-shorthand,vnote-rt,vnote-hdw,' +
    'vnote-unknown,vnote-divider,vnote-symbol,vnote-layout,vnote-title,vnote-mark,vnote-ai';

  const VNOTE_INLINE = 'vnote-font,vnote-color,vnote-heading,vnote-mark,vnote-rt,vnote-shorthand,vnote-unknown';
  const VNOTE_BLOCK = 'vnote-table,vnote-image,vnote-audio,vnote-video,vnote-doc,vnote-location,vnote-list,vnote-indent,vnote-divider,vnote-symbol,vnote-layout,vnote-title,vnote-hdw';

  tinymce.init({
    target: document.getElementById('content'),
    license_key: 'gpl',
    promotion: false,
    branding: false,
    language: 'zh_CN',
    language_url: 'static/tinymce/langs/zh_CN.js',
    base_url: 'static/tinymce/',
    suffix: '.min',
    height: '100%',       // 撑满 #content-wrap（flex:1）
    autoresize_bottom_margin: 0,
    width: '100%',
    menubar: false,           // 复刻版不显示文件菜单；原版 menubar:true
    contextmenu: ['textmenu', 'tablemenu'],
    statusbar: false,
    convert_fonts_to_spans: false,
    paste_filter_drop: false,
    extended_valid_elements: 'svg[*],path[*],circle[*],polygon[*],ellipse[*],ul[style],ol[style],vnote-mark[vcolor]',
    custom_elements: CUSTOM_ELEMENTS,
    vnote_inline_elements: VNOTE_INLINE,
    vnote_block_elements: VNOTE_BLOCK,
    indent_before: '',
    indent_after: '',
    paste_retain_style_properties:
      'text-align,text-indent,margin-inline-start,padding-inline-start,background-color,text-decoration,margin-left',
    plugins: PLUGINS,
    custom_undo_redo_levels: 20,
    // 真实限制参数
    vnote_image_limit_count: 70,
    vnote_table_limit_count: 50,
    vnote_video_limit_count: 20,
    vnote_audio_limit_count: 20,
    vnote_record_limit_count: 20,
    vnote_doc_limit_count: 20,
    vnote_word_limit_count: 30000,
    vnote_char_limit_count: 100000,
    vnote_single_file_limit: 209715200,
    ai_panel_max_length: 3500,
    ai_select_content_maxlength: 4000,
    vnote_indent_max_level: 5,
    vnote_list_max_level: 6,
    vnote_multilevel_list_enabled: true,
    vnote_plugin_charlen_map: {
      'vnote-layout': 250, 'vnote-font': 100, 'vnote-image': 120, 'vnote-video': 200,
      'vnote-table': 150, 'vnote-audio': 20, 'vnote-audio2': 200, 'vnote-doc': 200,
      'vnote-divider': 50, 'vnote-symbol': 50,
    },
    // 工具栏：复刻版用标准按钮（vnote 按钮依赖云端组件，先不挂）
    toolbar: 'undo redo | blocks fontfamily fontsize | bold italic underline strikethrough forecolor backcolor | ' +
             'alignleft aligncenter alignright | bullist numlist outdent indent | table image hr | ' +
             'searchreplace charmap emoticons | code fullscreen',
    toolbar_mode: 'wrap',
    content_style: `
      body { font-family: "vivo Sans SC VF","HarmonyOS Sans SC","Microsoft YaHei","PingFang SC",sans-serif;
             font-size: 15px; line-height: 1.8; color: rgba(0,0,0,.9); }
      p { margin: 0 0 8px; }
      vnote-font, vnote-color, vnote-heading, vnote-mark, vnote-rt { display: inline; }
    `,
    setup: (ed) => {
      ed.on('init', () => {
        window.__editorReady = true;
        console.log('[editor] TinyMCE ready, plugins loaded:',
          ed.plugins ? Object.keys(ed.plugins).length : '?');
      });
      ed.on('input change undo redo', () => {
        window.__editorDirty = true;
      });
    },
  });
})();
