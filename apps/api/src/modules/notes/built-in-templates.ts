/**
 * The templates that ship with the app.
 *
 * They are data, not code. That is the whole point: a new template is a row, so
 * one arrives without a release and a typo in one is a fix to a string rather
 * than a migration. A dozen is a starting set, not a limit.
 *
 * Every document here is written by hand in the note format rather than produced
 * by the editor, so it goes through the same validation as anything a person
 * types. If one of these ever fails that check, the catalogue is broken in a way
 * a test will say so about, rather than in a way that only shows up on a phone.
 */

/** A checkbox line, which is what most of these are made of. */
const line = (text: string, checked = false): string =>
  `<ul data-type="checkbox"><li${checked ? ' checked' : ''}>${text}</li></ul>`;

const step = (text: string): string => `<ol><li>${text}</li></ol>`;

const h = (text: string): string => `<h2>${text}</h2>`;

const p = (text: string): string => `<p>${text}</p>`;

export interface BuiltInTemplate {
  key: string;
  name: string;
  description: string;
  icon: string;
  /** The body, in the note format. */
  document: string;
}

export const BUILT_IN_TEMPLATES: BuiltInTemplate[] = [
  {
    key: 'recipe',
    name: 'Recipe',
    description: 'Ingredients, steps and what to watch out for.',
    icon: 'restaurant-outline',
    document: [
      h('Salsa de tomate'),
      p('Six ripe tomatoes per one of everything else.'),
      h('Serves'),
      p('4'),
      h('Time'),
      p('Preparation 15 min · Cooking 40 min'),
      h('Ingredients'),
      line('Tomatoes'),
      line('Onion'),
      line('Garlic'),
      h('Steps'),
      step('Soften the onion with a pinch of salt.'),
      step('Add the garlic, and do not let it brown.'),
      step('Tomatoes in, and cook down for half an hour.'),
      h('Notes'),
      p('Freezes well. Better the next day.'),
    ].join(''),
  },
  {
    key: 'instructions',
    name: 'Step-by-step guide',
    description: 'For anything somebody else has to follow exactly.',
    icon: 'list-outline',
    document: [
      h('What this is for'),
      p('Write the goal in one sentence, so somebody knows whether they are in the right place.'),
      h('What you need'),
      line(''),
      h('Steps'),
      step('First step.'),
      step('Second step.'),
      h('If it goes wrong'),
      p('What to do, and what not to do.'),
    ].join(''),
  },
  {
    key: 'meeting',
    name: 'Meeting notes',
    description: 'Agenda, decisions and who does what.',
    icon: 'people-outline',
    document: [
      h('Meeting'),
      p('Date · who is there'),
      h('Agenda'),
      step(''),
      h('Decisions'),
      p('What was decided, in words somebody can repeat a week later.'),
      h('Actions'),
      line('What, who, by when'),
      h('Next time'),
      p(''),
    ].join(''),
  },
  {
    key: 'journal',
    name: 'Daily journal',
    description: 'One day, a few lines.',
    icon: 'book-outline',
    document: [
      p('Monday, the day itself.'),
      h('What happened'),
      p(''),
      h('What to remember'),
      p(''),
    ].join(''),
  },
  {
    key: 'book',
    name: 'Book, film or series',
    description: 'What it was, and what it left you with.',
    icon: 'bookmark-outline',
    document: [
      h('Title'),
      p('Who wrote, directed or made it'),
      h('Rating'),
      p(''),
      h('In one line'),
      p(''),
      h('The parts worth keeping'),
      p(''),
      h('What it left me thinking'),
      p(''),
    ].join(''),
  },
  {
    key: 'project-brief',
    name: 'Project brief',
    description: 'Objective, scope, milestones and risks.',
    icon: 'flag-outline',
    document: [
      h('What we are trying to do'),
      p(''),
      h('In scope'),
      line(''),
      h('Not in scope'),
      line(''),
      h('Milestones'),
      line('By when, and what has to be true'),
      h('Risks'),
      line(''),
      h('Who is involved'),
      p(''),
    ].join(''),
  },
  {
    key: 'decision',
    name: 'Decision record',
    description: 'Context, decision, alternatives, consequences.',
    icon: 'git-branch-outline',
    document: [
      h('The decision'),
      p('One sentence, in the present tense, as though it were already made.'),
      h('Why now'),
      p('The context somebody needs in a year to understand it.'),
      h('What else we considered'),
      line(''),
      h('What this means'),
      line(''),
      h('Status'),
      p('Proposed · accepted · superseded'),
    ].join(''),
  },
  {
    key: 'shopping',
    name: 'Shopping list',
    description: 'Grouped by aisle, with the estimated total at the end.',
    icon: 'cart-outline',
    document: [
      h('Produce'),
      line(''),
      h('Dairy'),
      line(''),
      h('Dry goods'),
      line(''),
      h('Estimated'),
      p(''),
    ].join(''),
  },
  {
    key: 'trip',
    name: 'Trip plan',
    description: 'Where, when, and what to pack.',
    icon: 'airplane-outline',
    document: [
      h('Where and when'),
      p(''),
      h('Day by day'),
      step(''),
      h('Packing'),
      line(''),
      h('Bookings'),
      line(''),
    ].join(''),
  },
  {
    key: 'review',
    name: 'Weekly review',
    description: 'What went well, what to change, what is next.',
    icon: 'refresh-outline',
    document: [
      h('What went well'),
      line(''),
      h('What to change'),
      line(''),
      h('Next week'),
      line(''),
    ].join(''),
  },
  {
    key: 'workout',
    name: 'Workout log',
    description: 'Routine, sets and how it felt.',
    icon: 'barbell-outline',
    document: [
      h('Today'),
      p('Routine and weight'),
      h('Sets'),
      line('Exercise · reps · weight'),
      h('How it felt'),
      p(''),
    ].join(''),
  },
  {
    key: 'lesson',
    name: 'Class or lesson plan',
    description: 'Objective, materials, steps, and how to check it landed.',
    icon: 'school-outline',
    document: [
      h('By the end of this, somebody can…'),
      p(''),
      h('Materials'),
      line(''),
      h('Steps'),
      step(''),
      h('How to check they understood'),
      p(''),
    ].join(''),
  },
];

/** The catalogue by key, for the seed and for tests. */
export const BUILT_IN_BY_KEY = new Map(BUILT_IN_TEMPLATES.map((t) => [t.key, t]));
