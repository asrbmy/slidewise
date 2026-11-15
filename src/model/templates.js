import { createDeck, createSlide, createShape, createChart, createTable, createTextBox } from './factory.js';
import { txFromPlain } from './text.js';
import { SIZE_PRESETS } from './constants.js';
import { addObjects } from './ops.js';

const S = SIZE_PRESETS['16:9'];
const withTitleBody = (title, body, layout = 'titleContent') => createSlide(S, layout, { title, body });
const bullets = (s) => s.map((x) => x).join('\n');

export const TEMPLATES = [
  { id: 'blank', name: 'Blank presentation', description: 'One title slide', build: () => createDeck({ name: 'Untitled presentation' }) },
  { id: 'pitch', name: 'Pitch deck', description: 'Problem, solution, traction, ask', build: () => {
    const slides = [
      createSlide(S, 'title', { title: 'Your startup name', subtitle: 'One sentence that explains what you do' }),
      withTitleBody('The problem', bullets(['Who has the problem', 'How painful it is today', 'What existing options miss'])),
      withTitleBody('Our solution', bullets(['What we built', 'Why it works better', 'How it feels to use'])),
      createSlide(S, 'twoColumn', { title: 'Market', body: bullets(['Total market', 'Our first segment']) }),
      createSlide(S, 'titleContent', { title: 'Traction' }),
      createSlide(S, 'sectionHeader', { title: 'The ask', subtitle: 'What we need and what it unlocks' }),
    ];
    let d = createDeck({ name: 'Pitch deck', themeId: 'midnight', slides });
    const ch = createChart('bar', { x: 200, y: 190, w: 880, h: 440, title: 'Monthly active users', categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'], series: [{ name: 'Users', values: [120, 190, 310, 480, 720, 1100] }], legend: false });
    d = addObjects(d, slides[4].id, [ch]);
    return d;
  } },
  { id: 'status', name: 'Project status', description: 'Weekly update with a table and chart', build: () => {
    const slides = [
      createSlide(S, 'title', { title: 'Project status', subtitle: 'Week of …' }),
      createSlide(S, 'titleContent', { title: 'Highlights', body: bullets(['Shipped …', 'On track …', 'At risk …']) }),
      createSlide(S, 'titleContent', { title: 'Milestones' }),
      createSlide(S, 'titleContent', { title: 'Burn-down' }),
    ];
    let d = createDeck({ name: 'Project status', themeId: 'slate', slides });
    const t = createTable(4, 3, { x: 90, y: 200, w: 1100, h: 300 }); t.cells = [['Milestone', 'Owner', 'Status'], ['Design complete', 'Sam', 'Done'], ['Beta release', 'Priya', 'In progress'], ['Launch', 'Lee', 'Planned']];
    d = addObjects(d, slides[2].id, [t]);
    d = addObjects(d, slides[3].id, [createChart('line', { x: 200, y: 190, w: 880, h: 440, title: 'Open tasks', categories: ['W1', 'W2', 'W3', 'W4', 'W5'], series: [{ name: 'Open', values: [42, 35, 28, 15, 6] }], legend: false })]);
    return d;
  } },
  { id: 'lesson', name: 'Lesson', description: 'Goals, ideas, practice, recap', build: () => {
    const slides = [
      createSlide(S, 'title', { title: 'Lesson title', subtitle: 'Course · Date' }),
      createSlide(S, 'titleContent', { title: 'Learning goals', body: bullets(['Understand …', 'Be able to …', 'Apply …']) }),
      createSlide(S, 'twoColumn', { title: 'Key ideas', body: bullets(['Idea one', 'Idea two']) }),
      createSlide(S, 'caption', { body: '', }),
      createSlide(S, 'titleContent', { title: 'Practice', body: bullets(['Try this …', 'Then this …']) }),
      createSlide(S, 'sectionHeader', { title: 'Recap', subtitle: 'Three things to remember' }),
    ];
    return createDeck({ name: 'Lesson', themeId: 'paper', slides });
  } },
  { id: 'portrait', name: 'Showcase (4:3)', description: 'Standard-ratio deck with a bold theme', build: () => {
    const size = SIZE_PRESETS['4:3'];
    const slides = [createSlide(size, 'title', { title: 'Showcase', subtitle: 'Your name' }), createSlide(size, 'titleContent', { title: 'About', body: bullets(['First point', 'Second point']) }), createSlide(size, 'sectionHeader', { title: 'Thank you', subtitle: 'Questions?' })];
    return createDeck({ name: 'Showcase', size, themeId: 'sunset', slides });
  } },
];
export function buildTemplate(id) { const t = TEMPLATES.find((x) => x.id === id) || TEMPLATES[0]; return t.build(); }
void createShape; void createTextBox; void txFromPlain;
