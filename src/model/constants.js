export const SCHEMA_VERSION = 1;

export const LIMITS = {
  maxSlides: 1000,
  maxObjectsPerSlide: 500,
  maxTotalObjects: 20000,
  maxGroupDepth: 6,
  maxTextChars: 200000,
  maxImageBytes: 15 * 1024 * 1024,
  maxAssetsBytes: 150 * 1024 * 1024,
  maxImportFileBytes: 200 * 1024 * 1024,
  maxPptxEntries: 3000,
  maxPptxUncompressed: 400 * 1024 * 1024,
  maxTableCells: 2500,
  maxChartPoints: 2000,
  maxDecksInBackup: 500,
  maxNameLength: 200,
  minSlideSize: 200,
  maxSlideSize: 5000,
};

export const SIZE_PRESETS = {
  '16:9': { w: 1280, h: 720 },
  '4:3': { w: 960, h: 720 },
};

export const SHAPES = ['rect', 'roundRect', 'ellipse', 'triangle', 'arrow', 'line', 'star'];
export const SHAPE_LABELS = { rect: 'Rectangle', roundRect: 'Rounded rectangle', ellipse: 'Ellipse', triangle: 'Triangle', arrow: 'Arrow', line: 'Line', star: 'Star' };
export const OBJECT_TYPES = ['text', 'shape', 'image', 'table', 'chart', 'group'];
export const CHART_KINDS = ['bar', 'line', 'pie'];
export const ANIM_TYPES = ['none', 'fade', 'slide', 'zoom'];
export const ANIM_DIRS = ['left', 'right', 'up', 'down'];
export const TRANSITIONS = ['none', 'fade', 'slide', 'zoom'];
export const LAYOUTS = ['title', 'titleContent', 'twoColumn', 'sectionHeader', 'blank', 'caption'];
export const LAYOUT_LABELS = { title: 'Title', titleContent: 'Title and content', twoColumn: 'Two columns', sectionHeader: 'Section header', blank: 'Blank', caption: 'Caption' };
export const ROLES = ['title', 'subtitle', 'body', 'body2', 'caption'];

export const FONTS = {
  sans: { label: 'Sans (system)', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
  serif: { label: 'Serif (Georgia)', stack: 'Georgia, "Times New Roman", Times, serif' },
  mono: { label: 'Monospace', stack: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Courier New", monospace' },
  arial: { label: 'Arial', stack: 'Arial, "Helvetica Neue", Helvetica, sans-serif' },
  times: { label: 'Times New Roman', stack: '"Times New Roman", Times, serif' },
  verdana: { label: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
  trebuchet: { label: 'Trebuchet MS', stack: '"Trebuchet MS", "Lucida Grande", sans-serif' },
  courier: { label: 'Courier New', stack: '"Courier New", Courier, monospace' },
  impact: { label: 'Impact', stack: 'Impact, "Arial Narrow Bold", sans-serif' },
  rounded: { label: 'Rounded', stack: 'ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", Quicksand, "Varela Round", system-ui, sans-serif' },
};
export const FONT_KEYS = Object.keys(FONTS);
export const FONT_TOKENS = ['@heading', '@body'];
export const COLOR_TOKENS = ['@bg', '@surface', '@text', '@muted', '@accent1', '@accent2', '@accent3', '@accent4', '@accent5', '@accent6'];
export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
