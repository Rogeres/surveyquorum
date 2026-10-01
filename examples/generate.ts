/**
 * Synthetic demo dataset generator.
 *
 * Produces `examples/demo-dataset.json`, `examples/demo-ground-truth.json` and
 * `examples/demo-answers.csv` from a seeded PRNG. Every survey, question, option, card,
 * open answer and persona in this file is invented; nothing comes from real respondents.
 *
 * Deterministic: same seed → byte-identical files. Run with `npm run examples:generate`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDataset } from '../packages/core/src/contract/schema.js';
import type {
  Block,
  Dataset,
  InventoryItem,
  QualityLabel,
  Response,
  ScreeningAnswer,
  Survey,
} from '../packages/core/src/contract/types.js';

const SEED = 20261001;
const RESPONSES_PER_SURVEY = 100;

// ----------------------------------------------------------------------------
// Seeded randomness
// ----------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  private readonly next: () => number;

  constructor(seed: number) {
    this.next = mulberry32(seed);
  }

  float(min = 0, max = 1): number {
    return min + (max - min) * this.next();
  }

  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  sample<T>(items: readonly T[], k: number): T[] {
    return this.shuffle(items).slice(0, Math.max(0, Math.min(k, items.length)));
  }

  /** Standard normal via Box–Muller. */
  normal(mean = 0, sd = 1): number {
    const u = 1 - this.next();
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Log-normal with the given median and log-space sigma. */
  lognormal(median: number, sigma: number): number {
    return median * Math.exp(this.normal(0, sigma));
  }
}

const round1 = (x: number): number => Math.round(x * 10) / 10;
const round3 = (x: number): number => Math.round(x * 1000) / 1000;
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

// ----------------------------------------------------------------------------
// Personas
// ----------------------------------------------------------------------------

type Persona =
  | 'honest'
  | 'honest_profane'
  | 'honest_dont_know'
  | 'honest_single_outlier'
  | 'speedster'
  | 'copy_paster'
  | 'gibberish'
  | 'straightliner'
  | 'mass_selector'
  | 'give_upper'
  | 'same_spot_clicker'
  | 'random_sorter'
  | 'imposter';

const LABELS: Record<Persona, QualityLabel> = {
  honest: 'good',
  honest_profane: 'good',
  honest_dont_know: 'good',
  honest_single_outlier: 'good',
  speedster: 'bad_content',
  copy_paster: 'bad_content',
  gibberish: 'bad_content',
  straightliner: 'bad_content',
  mass_selector: 'bad_content',
  give_upper: 'bad_content',
  same_spot_clicker: 'bad_content',
  random_sorter: 'bad_content',
  imposter: 'bad_coherence',
};

const HONEST_LIKE: ReadonlySet<Persona> = new Set([
  'honest',
  'honest_profane',
  'honest_dont_know',
  'honest_single_outlier',
]);

// ----------------------------------------------------------------------------
// Survey specifications
// ----------------------------------------------------------------------------

type QType =
  | 'open'
  | 'choice'
  | 'scale'
  | 'matrix'
  | 'cardsort'
  | 'prototype'
  | 'website'
  | 'firstclick';

interface QDef {
  id: string;
  type: QType;
  question: string;
  /** Typical honest duration in seconds (median of the log-normal). */
  typical: number;
  options?: string[];
  multi?: boolean;
  scaleMin?: number;
  scaleMax?: number;
  rows?: string[];
  columns?: string[];
  /** Honest open answers and optional add-on sentences. */
  answers?: string[];
  extras?: string[];
  /** Open answers an imposter gives (b2b). */
  imposter?: string[];
  /** Open answers from respondents whose prototype failed to load (ux artifact). */
  loadFail?: string[];
  /** Design artifact: ~60% of honest respondents answer one word yes/no. */
  yesNoArtifact?: boolean;
  /** Design artifact: this prototype fails to load for part of the cohort. */
  loadFailArtifact?: boolean;
  /** Scale questions sharing this key form a run (straightliners answer them identically). */
  runGroup?: string;
  /** First-click target (normalized). */
  target?: { top: number; left: number };
  cards?: string[];
  /** Hidden "true" grouping for card sorts with naming variants per group. */
  groups?: { names: string[]; cards: string[] }[];
}

interface ScreeningDef {
  question: string;
  options: string[];
  /** Options an honest in-target respondent picks. */
  pass: string[];
}

interface SurveySpec {
  id: string;
  prefix: string;
  source: string;
  target?: string;
  screening?: ScreeningDef[];
  questions: QDef[];
  personas: Partial<Record<Persona, number>>;
  /** Profane but on-topic sentences appended by `honest_profane`. */
  profanity: string[];
  /** Short honest-looking answers for offenders whose open text is not the signal. */
  brief: string[];
}

const AGREEMENT = [
  'Strongly disagree',
  'Disagree',
  'Neither agree nor disagree',
  'Agree',
  'Strongly agree',
];

const UX: SurveySpec = {
  id: 'demo-ux',
  prefix: 'ux',
  source: 'demo-panel',
  target: 'Adults who have ordered groceries online at least once in the last year',
  personas: {
    honest: 71,
    honest_profane: 3,
    honest_dont_know: 3,
    honest_single_outlier: 3,
    speedster: 6,
    copy_paster: 4,
    gibberish: 3,
    give_upper: 4,
    same_spot_clicker: 3,
  },
  profanity: [
    'Honestly the damn menu kept jumping around while I scrolled.',
    'It was a hell of a lot easier than I expected.',
    'The search box was bloody useless for this.',
    'Took me way too damn long to spot the button.',
    'Crap, I nearly gave up on that one.',
  ],
  brief: ['It was easy.', 'Fine, no issues.', 'Pretty simple.', 'All good.', 'Easy enough.'],
  questions: [
    {
      id: 'ux-q01',
      type: 'choice',
      question: 'How often do you order groceries online?',
      typical: 9,
      options: [
        'Never',
        'A few times a year',
        'About once a month',
        'About once a week',
        'Several times a week',
      ],
    },
    {
      id: 'ux-q02',
      type: 'prototype',
      question:
        'Task 1: Using the Marrow prototype, add a bag of oranges to your basket and proceed to checkout.',
      typical: 70,
    },
    {
      id: 'ux-q03',
      type: 'open',
      question: 'What, if anything, was confusing about adding an item to the basket?',
      typical: 45,
      answers: [
        'Nothing really confusing, the plus button on the product card did what I expected.',
        "The basket icon didn't update right away so I wasn't sure the oranges had actually been added.",
        'I expected a quantity picker before adding, instead it added one bag straight away.',
        "The search result showed loose oranges and a bag and I wasn't sure which one the task wanted.",
        'Took me a moment to find the basket, I was looking at the bottom bar but it sits top right.',
        "Honestly the flow was fine, though the 'add' label is tiny on my phone.",
        'I tapped the picture first thinking it would add the item, it opened a detail page instead.',
        'The checkout button is hidden under the basket summary, I scrolled past it twice.',
        'Nothing confusing, pretty standard grocery app pattern.',
        'The substitution toggle popped up before I even reached checkout, that threw me off.',
        "I wasn't sure if the price shown was per bag or per kilo.",
        'Adding was easy, proceeding to checkout was less obvious because the button only appears after a scroll.',
      ],
      extras: [
        'A small confirmation toast would help.',
        'Otherwise it worked as I expected.',
        'On a bigger screen it would probably be fine.',
        'I got there in the end though.',
        'Maybe make the basket badge animate when something is added.',
        'I use a similar app weekly so the pattern was familiar.',
        'It just needs clearer labels.',
      ],
    },
    {
      id: 'ux-q04',
      type: 'scale',
      question: 'How easy was it to complete Task 1? (1 = very hard, 7 = very easy)',
      typical: 4,
      scaleMin: 1,
      scaleMax: 7,
    },
    {
      id: 'ux-q05',
      type: 'firstclick',
      question: 'Where would you click first to change your delivery address?',
      typical: 8,
      target: { top: 0.08, left: 0.82 },
    },
    {
      id: 'ux-q06',
      type: 'firstclick',
      question: "Where would you click first to find yesterday's order?",
      typical: 8,
      target: { top: 0.93, left: 0.62 },
    },
    {
      id: 'ux-q07',
      type: 'prototype',
      question: 'Task 2: Schedule a delivery for tomorrow between 6 and 8 pm.',
      typical: 90,
      loadFailArtifact: true,
    },
    {
      id: 'ux-q08',
      type: 'open',
      question: 'Describe how you went about scheduling the delivery. What did you expect to see?',
      typical: 55,
      answers: [
        'I opened the basket, found the delivery slot section and picked tomorrow evening, then scrolled to the six to eight option.',
        "I expected a calendar on the checkout page but the slots were in a separate screen behind 'delivery details'.",
        'I went to my account first thinking the schedule lived there, then backtracked to checkout.',
        'There was a list of days across the top and time windows below, I tapped tomorrow and then the evening slot.',
        "I expected to see the slot picker before payment and that's where it was, so no surprises.",
        'I found it under checkout but the evening slot said limited availability so I hesitated before choosing it.',
        "I tried tapping the delivery address thinking the time would be there, it wasn't, so I kept scrolling.",
        'The day tabs were clear but the time windows were two-hour blocks starting at odd hours, so I picked the closest one.',
        "Pretty straightforward, checkout then 'choose a slot' then tomorrow then 6 to 8 pm.",
        "I expected a 'schedule for later' button on the basket page and had to hunt for it in checkout instead.",
      ],
      extras: [
        'A default of tomorrow would save a tap.',
        'The slot picker felt a bit cramped.',
        'I liked that it showed the delivery fee per slot.',
        'I would have preferred a calendar view.',
        'It worked, just more steps than I expected.',
        'The confirmation screen made it clear which slot I chose.',
      ],
      loadFail: [
        'The prototype never loaded for me, I just saw a grey screen and gave up after a few seconds.',
        "Nothing happened when the task started, the screen stayed blank so I couldn't do anything.",
        "It didn't load, I waited a bit and then pressed give up because there was nothing to click.",
        "The second task showed a spinner and never finished loading, so I couldn't try it.",
        'Blank screen on my side, I expected the same checkout flow as the first task but nothing appeared.',
      ],
    },
    {
      id: 'ux-q09',
      type: 'scale',
      question:
        'How confident are you that the delivery would arrive in the slot you chose? (1 = not at all, 7 = completely)',
      typical: 4,
      scaleMin: 1,
      scaleMax: 7,
    },
    {
      id: 'ux-q10',
      type: 'firstclick',
      question: 'Where would you click first to apply a promo code?',
      typical: 8,
      target: { top: 0.71, left: 0.5 },
    },
    {
      id: 'ux-q11',
      type: 'website',
      question: 'Visit the Marrow help centre and find out how to report a missing item.',
      typical: 80,
    },
    {
      id: 'ux-q12',
      type: 'open',
      question: 'How did finding the missing-item instructions go? What would you change?',
      typical: 50,
      answers: [
        "I searched for 'missing item' in the help centre and the second article explained how to report it from the order page.",
        "It took a while, the help centre groups articles by topic and 'missing item' sits under payments for some reason.",
        'Found it quickly through the search bar, though the article was long and the actual steps were at the bottom.',
        "I browsed the orders section first, it wasn't there, then the search found it.",
        'The help centre asked me to log in before showing anything which was annoying for a quick question.',
        "I found a chat button before I found the article, so I'd probably just use chat in real life.",
        "The instructions were clear once I found them, but 'report a problem' would be a better title than 'order discrepancies'.",
        'Fine overall, two clicks from the help home page.',
        'I had to scroll past a lot of promotional content before reaching the help links.',
        'Search worked but the top result was about missing deliveries, not missing items, which are different things.',
      ],
      extras: [
        "I'd put the most common problems on the help home page.",
        'A direct link from the order would be better.',
        'Took me about a minute.',
        'The article could use screenshots.',
        'I would make the search box bigger.',
        'Otherwise no complaints.',
      ],
    },
    {
      id: 'ux-q13',
      type: 'choice',
      multi: true,
      question: 'Which of these features would you use? Select all that apply.',
      typical: 14,
      options: [
        'Reorder a previous basket',
        'Scheduled recurring deliveries',
        'Recipe-based shopping lists',
        'Live order tracking',
        'Substitution preferences per item',
        'Shared household basket',
        'Price alerts on favourites',
        'None of these',
      ],
    },
    {
      id: 'ux-q14',
      type: 'scale',
      question:
        'How likely are you to recommend Marrow to a friend? (0 = not at all, 10 = extremely)',
      typical: 5,
      scaleMin: 0,
      scaleMax: 10,
    },
    {
      id: 'ux-q15',
      type: 'open',
      question: 'Anything else you want to tell the Marrow team?',
      typical: 35,
      answers: [
        "The app feels fast and the product photos are good, I'd try it for a real order.",
        "Please add a way to reorder last week's basket in one tap.",
        'Prices seemed higher than my usual supermarket, that would be the deciding factor for me.',
        'The green colour scheme is pleasant but some text is low contrast.',
        "I'd like to see substitution preferences per item rather than one global toggle.",
        'Nothing else, the test was clear and the tasks were realistic.',
        "Let me filter by dietary needs, I couldn't find a vegan filter anywhere.",
        'The delivery fee should be shown earlier, before I fill the basket.',
        'Good luck with the launch, the basics seem solid.',
        "I'd want a dark mode and bigger tap targets on the slot picker.",
        'The onboarding asked for my address twice.',
        'Not much to add, maybe a loyalty scheme would get me to switch.',
      ],
      extras: [
        'Thanks for asking.',
        "That's all from me.",
        'Overall a decent experience.',
        'Keep it simple please.',
        'Happy to test again.',
      ],
    },
  ],
};

const CONSUMER: SurveySpec = {
  id: 'demo-consumer',
  prefix: 'co',
  source: 'demo-panel',
  target: 'Adults who eat packaged savoury snacks at least a few times a month',
  personas: {
    honest: 71,
    honest_profane: 3,
    honest_dont_know: 3,
    honest_single_outlier: 3,
    speedster: 6,
    copy_paster: 4,
    gibberish: 3,
    straightliner: 4,
    mass_selector: 3,
  },
  profanity: [
    'Damn good crisps, honestly.',
    'The bag is half air, which is bloody annoying.',
    "Hell, I'd buy them again tomorrow.",
    'The paprika one is too damn salty though.',
    'Crap packaging, great crisps.',
  ],
  brief: ['Good crisps.', 'Nice brand.', 'They are fine.', 'Tasty.', 'Decent snack.'],
  questions: [
    {
      id: 'co-q01',
      type: 'choice',
      question: 'Which best describes how often you eat packaged savoury snacks?',
      typical: 9,
      options: [
        'Rarely or never',
        'A few times a month',
        'A few times a week',
        'Most days',
        'Every day',
      ],
    },
    {
      id: 'co-q02',
      type: 'choice',
      multi: true,
      question:
        'Which snack brands have you bought in the last three months? Select all that apply.',
      typical: 15,
      options: [
        'Kettlebird',
        'Marsh & Fennel',
        'Pop Hollow',
        'Crunchfield',
        'Old Mill Crisps',
        'Saltwater Co.',
        'Brindle Snacks',
        'Tumbleroot',
        'Supermarket own brand',
        'None of these',
      ],
    },
    {
      id: 'co-q03',
      type: 'matrix',
      question: 'Thinking about Kettlebird crisps, how much do you agree with each statement?',
      typical: 40,
      rows: [
        'Kettlebird tastes better than other brands',
        'Kettlebird is good value for money',
        'Kettlebird uses quality ingredients',
        'Kettlebird is a brand I trust',
        'Kettlebird is easy to find in shops',
        'Kettlebird is a brand for people like me',
      ],
      columns: AGREEMENT,
    },
    {
      id: 'co-q04',
      type: 'open',
      question: 'What comes to mind when you think of Kettlebird?',
      typical: 40,
      answers: [
        'Thick-cut crisps in a brown paper bag, slightly pricey but good for a weekend treat.',
        'The orange kettle logo and that strong vinegar flavour, I always think of pub snacks.',
        'Crunchy, a bit greasy, the kind of crisps you buy when you want something better than the supermarket brand.',
        'A small brand I see at the farm shop and the petrol station but nowhere else.',
        "Honest ingredients and a short list on the back, I like that they don't hide stuff.",
        'The sharing bags are huge and I never finish one on my own.',
        'Rustic packaging, farmer imagery, slightly premium positioning.',
        'I think of road trips, we always grab a bag at the services.',
        'Good crunch but too much salt on the paprika one.',
        "Not a brand I know well, I've seen it in the premium aisle.",
        'The chilli flavour is genuinely hot, which is rare for crisps.',
        'Quality potatoes, you can tell from the texture.',
      ],
      extras: [
        'Could be cheaper though.',
        'My kids like them too.',
        "Haven't had them in a while.",
        "I'd buy them more if they were on offer.",
        'The bag is hard to reseal.',
        'Decent brand overall.',
      ],
    },
    {
      id: 'co-q05',
      type: 'choice',
      multi: true,
      question: 'Where do you usually buy snacks? Select all that apply.',
      typical: 13,
      options: [
        'Large supermarket',
        'Local convenience store',
        'Petrol station',
        'Online grocery delivery',
        'Farm shop or deli',
        'Vending machine',
        'Cinema or venue',
        'Discount store',
        'Somewhere else',
      ],
    },
    ...['taste', 'price', 'packaging', 'availability', 'variety', 'healthiness'].map(
      (aspect, i): QDef => ({
        id: `co-q${String(6 + i).padStart(2, '0')}`,
        type: 'scale',
        question: `How would you rate Kettlebird on ${aspect}? (1 = poor, 5 = excellent)`,
        typical: 4,
        scaleMin: 1,
        scaleMax: 5,
        runGroup: 'ratings',
      }),
    ),
    {
      id: 'co-q12',
      type: 'matrix',
      question: 'How much do you agree with these statements about snack packaging?',
      typical: 38,
      rows: [
        'Resealable bags are important to me',
        'I notice the packaging design when choosing snacks',
        'Paper packaging makes me think a brand is sustainable',
        'I read the ingredient list before buying',
        'Sharing bags are too large for me',
        'Clear nutrition labels influence what I buy',
      ],
      columns: AGREEMENT,
    },
    {
      id: 'co-q13',
      type: 'open',
      question: 'Have you tried the new Kettlebird Sea Salt & Thyme flavour?',
      typical: 25,
      yesNoArtifact: true,
      answers: [
        'Yes, tried it last week, the thyme is subtle and the salt level is about right.',
        "No, I haven't seen it in my local shop yet, I'd try it if I spotted it.",
        "Yes, once at a friend's place, it tasted a bit like stuffing which I didn't mind.",
        "No, herb flavours aren't really my thing, I stick to salt and vinegar.",
        "Yes, I liked it but it's not as good as the rosemary one they did a few years ago.",
        "Not yet, but it's on my list for the weekend shop.",
        'Yes, bought two bags and they were gone in a day, very moreish.',
        "No, didn't know it existed until this survey.",
        "Yes, a bit too herby for me, I'd rather plain sea salt.",
      ],
    },
    {
      id: 'co-q14',
      type: 'choice',
      multi: true,
      question: 'Which flavours would you like Kettlebird to launch next? Select all that apply.',
      typical: 16,
      options: [
        'Smoked paprika',
        'Sour cream & chive',
        'Black pepper & lime',
        'Honey mustard',
        'Truffle',
        'Sweet chilli',
        'Cheese & onion',
        'Salted caramel',
        'Wasabi',
        'Rosemary & garlic',
        'Pickled onion',
        'Plain unsalted',
      ],
    },
    {
      id: 'co-q15',
      type: 'matrix',
      question: 'How much do you agree with these statements about snacking occasions?',
      typical: 36,
      rows: [
        'I snack mainly in the evening',
        'I buy snacks on impulse',
        'I plan snacks as part of the weekly shop',
        'I prefer savoury snacks over sweet ones',
        'I eat more snacks when watching TV',
        'I try to limit how often I snack',
      ],
      columns: AGREEMENT,
    },
    {
      id: 'co-q16',
      type: 'choice',
      multi: true,
      question: 'On which occasions do you snack? Select all that apply.',
      typical: 12,
      options: [
        'With a drink in the evening',
        'At lunch',
        'Watching films or TV',
        'Road trips',
        'Parties and gatherings',
        'Mid-afternoon at work',
        'Late at night',
        'Picnics and outdoors',
      ],
    },
    {
      id: 'co-q17',
      type: 'open',
      question: 'If you could change one thing about Kettlebird, what would it be?',
      typical: 45,
      answers: [
        'Make the bags resealable, half the time the crisps go soft before I finish them.',
        "Lower the price a little, it's hard to justify over the supermarket's own brand.",
        "Less salt on the paprika flavour, it's overpowering.",
        'Smaller single-serve bags for lunchboxes would be great.',
        'Better availability, I can only find them in two shops near me.',
        'Bring back the mature cheddar flavour, that was my favourite.',
        'The packaging looks dated, it needs a refresh.',
        'Add a baked or lower-fat option for people who want a lighter snack.',
        "Multipacks please, I don't want a sharing bag every time.",
        'Fewer broken crisps at the bottom of the bag.',
        "Nothing really, I'd keep them as they are.",
        'A clearer label about allergens, the print is tiny.',
      ],
      extras: [
        'That would make me buy them more often.',
        "Otherwise I'm happy with them.",
        'Just my opinion.',
        'Small thing but it matters.',
        'Everything else is fine.',
      ],
    },
    {
      id: 'co-q18',
      type: 'choice',
      question: 'How likely are you to buy Kettlebird in the next month?',
      typical: 8,
      options: ['Very unlikely', 'Unlikely', 'Not sure', 'Likely', 'Very likely'],
    },
  ],
};

const B2B: SurveySpec = {
  id: 'demo-b2b',
  prefix: 'b2b',
  source: 'demo-panel',
  target:
    'Owners or co-owners of businesses with 2–50 employees, decision makers on software purchases',
  personas: {
    honest: 68,
    honest_profane: 2,
    honest_dont_know: 3,
    honest_single_outlier: 3,
    speedster: 6,
    copy_paster: 4,
    gibberish: 3,
    random_sorter: 5,
    imposter: 6,
  },
  profanity: [
    'The onboarding was a damn mess.',
    'Half of these tools are bloody overpriced for what they do.',
    'Hell of a lot of time wasted on invoices every month.',
    'Support took a damn week to reply.',
  ],
  brief: [
    'Mostly recommendations from other owners.',
    'Time, mainly.',
    'Price and reliability.',
    'It depends on the tool.',
    'Nothing specific comes to mind.',
  ],
  screening: [
    {
      question: 'Which best describes your role?',
      options: [
        'Owner or co-owner',
        'Senior manager',
        'Employee without a purchasing role',
        'Not currently employed',
        'Student',
      ],
      pass: ['Owner or co-owner'],
    },
    {
      question: 'How many people does your business employ, including you?',
      options: ['Just me', '2–10', '11–50', '51–200', 'More than 200'],
      pass: ['2–10', '11–50'],
    },
    {
      question:
        'Have you personally decided on a software purchase for the business in the last 12 months?',
      options: ['Yes', 'No', 'Not sure'],
      pass: ['Yes'],
    },
  ],
  questions: [
    {
      id: 'b2b-q01',
      type: 'choice',
      question: 'Which of these back-office areas takes the most of your time each week?',
      typical: 10,
      options: [
        'Bookkeeping and invoices',
        'Payroll and staff admin',
        'Stock and suppliers',
        'Customer bookings and messages',
        'Marketing',
        'None of these / not applicable',
      ],
    },
    {
      id: 'b2b-q02',
      type: 'cardsort',
      question:
        'Sort these twelve back-office tools into groups that make sense to you, and name each group.',
      typical: 110,
      cards: [
        'Invoicing',
        'Expense tracking',
        'Bookkeeping',
        'Tax filing',
        'Payroll',
        'Shift scheduling',
        'Hiring and applicant tracking',
        'Time-off requests',
        'Inventory counts',
        'Supplier orders',
        'Appointment booking',
        'Customer messaging',
      ],
      groups: [
        {
          names: ['Money', 'Finance', 'Accounting'],
          cards: ['Invoicing', 'Expense tracking', 'Bookkeeping', 'Tax filing'],
        },
        {
          names: ['People', 'Staff', 'HR'],
          cards: [
            'Payroll',
            'Shift scheduling',
            'Hiring and applicant tracking',
            'Time-off requests',
          ],
        },
        {
          names: ['Operations', 'Day to day', 'Customers and stock'],
          cards: [
            'Inventory counts',
            'Supplier orders',
            'Appointment booking',
            'Customer messaging',
          ],
        },
      ],
    },
    {
      id: 'b2b-q03',
      type: 'open',
      question: 'Describe the last software purchase you decided on: what, why, what went wrong.',
      typical: 70,
      answers: [
        'We moved payroll from spreadsheets to a cloud payroll tool because the accountant kept finding errors; the migration took twice as long as promised and two staff were paid late in the first month.',
        'Bought a scheduling app for the shop floor so people could swap shifts themselves; the problem was the mobile app logged everyone out weekly and the staff stopped using it.',
        'Switched invoicing software to get automatic reminders because late payments were killing our cash flow; the import mangled half our customer addresses and I had to fix them by hand.',
        "Signed up for an inventory tool to stop over-ordering at the café; it needed barcodes on everything and we never finished labelling, so it's half used.",
        'We bought a CRM for the sales side after losing track of quotes; it works but the per-seat pricing doubled when we added the two part-timers.',
        'Picked a booking system for the clinic so patients could book online; it went well apart from the SMS reminders costing more than the subscription itself.',
        'Chose an expense app because receipts were piling up in a shoebox; the card feed broke every few weeks and support took days to answer.',
        'We replaced our accounting package because the old one stopped being supported; the new one is fine but the first tax return came out wrong and we had to amend it.',
        'Bought a project tool for the agency to track client work; everyone used it for a month and then went back to email, so that was wasted money.',
        'Got a rota and time-off app for the restaurant; what went wrong was the integration with payroll never actually synced hours, so we still type them in.',
      ],
      extras: [
        'Lesson learned about trial periods.',
        "I'd still choose it again, just with more planning.",
        'Support was the weak point.',
        "We're still on it, for now.",
        "Next time I'll involve the bookkeeper earlier.",
      ],
      imposter: [
        "I don't actually have a company, I'm a student, so I haven't bought any business software, just a laptop for uni.",
        "Not applicable, I don't run a business. I filled in the earlier questions quickly.",
        "I'm studying at the moment and don't own anything, the last thing I bought was a games console.",
        "I don't have a company so nothing to describe here, sorry.",
        'Student here, no business, no software purchases, I thought this was a general survey.',
        "N/A I'm between jobs and have never owned a company.",
      ],
    },
    {
      id: 'b2b-q04',
      type: 'choice',
      multi: true,
      question: 'Which tools does your business currently pay for? Select all that apply.',
      typical: 14,
      options: [
        'Accounting software',
        'Payroll software',
        'Shift scheduling',
        'Inventory management',
        'Booking system',
        'CRM',
        'Email marketing',
        'Project management',
        'None of these',
      ],
    },
    {
      id: 'b2b-q05',
      type: 'scale',
      question:
        'How satisfied are you with your current accounting software? (1 = very dissatisfied, 5 = very satisfied)',
      typical: 4,
      scaleMin: 1,
      scaleMax: 5,
    },
    {
      id: 'b2b-q06',
      type: 'open',
      question: 'How do you usually hear about new business software?',
      typical: 40,
      answers: [
        'Mostly from the accountant and from other owners in the local business group chat.',
        'Podcasts aimed at small business owners, and then I look up the sponsors.',
        'Trade shows once a year and whatever the supplier reps mention when they visit.',
        'Online searches when something breaks, I rarely go looking otherwise.',
        'Recommendations from staff who used something at a previous job.',
        'Industry newsletters and the occasional webinar if the topic is relevant.',
        'My bookkeeper tells me what integrates with her systems and that decides it.',
        "Social media ads, annoyingly, they seem to know exactly what I'm struggling with.",
        "From the bank's business portal, they bundle a few tools with the account.",
        'Word of mouth at the chamber of commerce meetings.',
      ],
      extras: [
        "I'm wary of anything with a long contract.",
        'Reviews matter more than ads to me.',
        'I usually trial two before choosing.',
        'Price lists are rarely upfront though.',
      ],
      imposter: [
        "I don't use business software, I'm a student.",
        'Not applicable to me.',
        "Through my course probably, but I don't run a business.",
        "I don't have a company so I don't look for this stuff.",
      ],
    },
    {
      id: 'b2b-q07',
      type: 'choice',
      question: 'Who else is involved when you buy software for the business?',
      typical: 9,
      options: [
        'I decide alone',
        'My co-owner',
        'Our accountant or bookkeeper',
        'The staff who will use it',
        'An IT contractor',
        'Not applicable',
      ],
    },
    {
      id: 'b2b-q08',
      type: 'open',
      question: 'What stops you from switching a tool you are unhappy with?',
      typical: 50,
      answers: [
        "The time it takes to move the data across and retrain everyone, we're too small to lose a week on it.",
        "Fear that the new one will have different problems and I'll have paid twice.",
        'Our accountant is used to the current one and switching means switching how she works too.',
        "Annual contracts, we're locked in until next spring.",
        "Honestly just inertia, it's annoying but it works well enough most days.",
        "The integrations with the till and the bank took months to set up and I don't want to redo them.",
        'Staff pushback, the team hates learning new tools.',
        'I never have the time to properly evaluate alternatives.',
        'The export options are deliberately bad, getting our history out would be a nightmare.',
        'Cost of the overlap period when you pay for both while migrating.',
      ],
      extras: [
        "If someone did the migration for me I'd switch tomorrow.",
        "It's a real frustration.",
        "We'll probably live with it another year.",
        'Smaller firms get the worst of this.',
      ],
      imposter: [
        "I don't have any tools to switch, I don't own a business.",
        'Not applicable.',
        "No company here so this doesn't apply to me.",
        "I'm a student, I don't pay for business tools.",
      ],
    },
    {
      id: 'b2b-q09',
      type: 'scale',
      question:
        'How much of a priority is replacing one of your tools in the next 12 months? (1 = not a priority, 5 = top priority)',
      typical: 4,
      scaleMin: 1,
      scaleMax: 5,
    },
    {
      id: 'b2b-q10',
      type: 'choice',
      question:
        'What is your typical yearly budget for one business software subscription, in your local currency?',
      typical: 10,
      options: ['Under 200', '200 to 1,000', '1,000 to 5,000', 'More than 5,000', 'Not applicable'],
    },
    {
      id: 'b2b-q11',
      type: 'open',
      question: 'What would make you recommend a business tool to another owner?',
      typical: 40,
      answers: [
        'If it saved me measurable time each week and the support actually picked up the phone.',
        "Clear pricing that doesn't jump when you add a user, and a proper mobile app.",
        "It would need to just work without me babysitting it, that's the whole point.",
        'Good onboarding, someone who sets it up with you rather than a pile of help articles.',
        'Reliability above everything, if the till goes down on a Saturday I lose real money.',
        'An export button that gives me my data in a usable format, that shows they respect customers.',
        "If my staff adopted it without complaining, that's the real test.",
        "Being able to cancel monthly, I'd happily recommend a tool that doesn't trap you.",
        "Integrations with the accounting software so I don't type things twice.",
        'A fair price for a company of our size, not enterprise rates.',
      ],
      extras: [
        'Most tools fail on at least one of those.',
        "That's rarer than it should be.",
        "I've recommended two tools in ten years.",
        'Simple asks really.',
      ],
      imposter: [
        "I wouldn't know, I'm not a business owner.",
        "Not applicable, I don't own a business.",
        "Can't really say, I'm a student.",
        "No idea, I don't buy this kind of thing.",
      ],
    },
  ],
};

const SURVEYS: SurveySpec[] = [UX, CONSUMER, B2B];

// ----------------------------------------------------------------------------
// Shared answer pools for offenders
// ----------------------------------------------------------------------------

const SPEEDSTER_WORDS = [
  'good',
  'ok',
  'fine',
  'nice',
  'no',
  'yes',
  'nothing',
  'it was ok',
  'easy',
  'all good',
  'dont know',
  'fine i guess',
];
const COPY_PASTE_SENTENCES = [
  'I think it is pretty good overall.',
  'Everything was fine and easy to use.',
  'No problems at all with this one.',
  'It works well for what I need.',
  'Good experience, nothing to add here.',
  'I like it and would use it again.',
  'Seems fine to me, no complaints really.',
];
const GIBBERISH = [
  'asdkjh qwe',
  'fghj',
  'sdfsdf',
  'qwerty',
  'kjhkjh lkj',
  'zxcv zxcv',
  'hjkl',
  'aaaa',
  'lkjlkj',
  'wertwert',
  'dfgdfg sdf',
];
const DONT_KNOW = ["Don't know", 'No opinion', 'Not sure really', "I don't know", 'No idea, sorry'];
const GIVE_UPPER_TEXT = [
  'it was easy',
  'It was easy.',
  'easy',
  'all good',
  'it was fine',
  'everything was easy',
  'easy enough',
];
const YES_NO = ['Yes', 'No', 'yes', 'no', 'Yes.', 'No.', 'Nope', 'Yep'];

// ----------------------------------------------------------------------------
// Per-respondent state
// ----------------------------------------------------------------------------

interface RespondentState {
  persona: Persona;
  /** Multiplier on every block's duration (speed habit); 1 for an average respondent. */
  pace: number;
  /** Latent attitude for scales and matrices (1–5 space). */
  attitude: number;
  /** Index of the block answered in ~1 s (honest_single_outlier). */
  outlierBlock: number;
  /** Open block indexes that get a "don't know" (honest_dont_know). */
  dontKnowBlocks: Set<number>;
  /** Open block indexes that get a profane sentence appended (honest_profane). */
  profaneBlocks: Set<number>;
  pasted: string;
  gibberishNumber: boolean;
  sameSpot: { top: number; left: number };
  runValue: string | null;
  matrixStyle: 'flat' | 'zigzag';
  /** The prototype failed to load for this respondent (ux design artifact). */
  loadFailed: boolean;
}

function makeState(
  spec: SurveySpec,
  persona: Persona,
  rng: Rng,
  loadFailed: boolean,
): RespondentState {
  const openIdx = spec.questions.map((q, i) => (q.type === 'open' ? i : -1)).filter((i) => i >= 0);
  const nonOpenIdx = spec.questions
    .map((q, i) => (q.type !== 'open' ? i : -1))
    .filter((i) => i >= 0);
  const pace =
    persona === 'speedster'
      ? rng.float(0.15, 0.3)
      : clamp(Math.exp(rng.normal(0, 0.28)), 0.55, 1.9);
  return {
    persona,
    pace,
    attitude: clamp(rng.normal(3.5, 0.75), 1.5, 5),
    outlierBlock: persona === 'honest_single_outlier' ? rng.pick(nonOpenIdx) : -1,
    dontKnowBlocks: new Set(
      persona === 'honest_dont_know' ? rng.sample(openIdx, rng.int(1, 2)) : [],
    ),
    profaneBlocks: new Set(persona === 'honest_profane' ? rng.sample(openIdx, rng.int(1, 2)) : []),
    pasted: rng.pick(COPY_PASTE_SENTENCES),
    gibberishNumber: rng.chance(0.3),
    sameSpot: { top: round3(rng.float(0.3, 0.7)), left: round3(rng.float(0.3, 0.7)) },
    runValue: null,
    matrixStyle: rng.chance(0.65) ? 'flat' : 'zigzag',
    loadFailed,
  };
}

// ----------------------------------------------------------------------------
// Block generation
// ----------------------------------------------------------------------------

function duration(q: QDef, st: RespondentState, rng: Rng, sigma = 0.4): number {
  return round1(Math.max(0.6, rng.lognormal(q.typical * st.pace, sigma)));
}

function styleText(text: string, rng: Rng): string {
  let out = text;
  if (rng.chance(0.12)) out = out.charAt(0).toLowerCase() + out.slice(1);
  if (rng.chance(0.15) && out.endsWith('.')) out = out.slice(0, -1);
  return out;
}

function honestOpen(q: QDef, rng: Rng): string {
  const base = rng.pick(q.answers ?? ['No comment.']);
  const extra = q.extras && rng.chance(0.45) ? ` ${rng.pick(q.extras)}` : '';
  return styleText(`${base}${extra}`, rng);
}

function openText(spec: SurveySpec, q: QDef, idx: number, st: RespondentState, rng: Rng): string {
  const { persona } = st;
  if (q.loadFail && st.loadFailed) return styleText(rng.pick(q.loadFail), rng);
  if (st.dontKnowBlocks.has(idx)) return rng.pick(DONT_KNOW);
  switch (persona) {
    case 'speedster':
      return rng.pick(SPEEDSTER_WORDS);
    case 'copy_paster':
      return st.pasted;
    case 'gibberish':
      return st.gibberishNumber && rng.chance(0.5) ? String(rng.int(1, 99)) : rng.pick(GIBBERISH);
    case 'give_upper':
      return rng.pick(GIVE_UPPER_TEXT);
    case 'imposter':
      return styleText(rng.pick(q.imposter ?? ['Not applicable.']), rng);
    case 'straightliner':
    case 'mass_selector':
    case 'same_spot_clicker':
    case 'random_sorter':
      // Offenders whose signal lives elsewhere: short but on-topic text, sometimes substantive.
      return rng.chance(0.4) ? honestOpen(q, rng) : rng.pick(spec.brief);
    default: {
      if (q.yesNoArtifact && rng.chance(0.6)) return rng.pick(YES_NO);
      let text = honestOpen(q, rng);
      if (st.profaneBlocks.has(idx)) text = `${text} ${rng.pick(spec.profanity)}`;
      return text;
    }
  }
}

function openDuration(q: QDef, st: RespondentState, rng: Rng, text: string): number {
  const words = text.split(/\s+/).length;
  if (st.persona === 'speedster') return duration(q, st, rng, 0.3);
  if (st.persona === 'copy_paster') return round1(rng.lognormal(q.typical * 0.35, 0.3));
  if (st.persona === 'gibberish') return round1(rng.lognormal(q.typical * 0.3, 0.35));
  if (st.persona === 'give_upper') return round1(rng.lognormal(q.typical * 0.3, 0.3));
  if (words <= 2) return round1(rng.lognormal(q.typical * 0.35, 0.35));
  // Longer answers take longer, with noise.
  const factor = clamp(0.6 + words / 30, 0.6, 1.6);
  return round1(Math.max(2, rng.lognormal(q.typical * st.pace * factor, 0.35)));
}

function scaleAnswer(q: QDef, st: RespondentState, rng: Rng): string {
  const lo = q.scaleMin ?? 1;
  const hi = q.scaleMax ?? 5;
  if (st.persona === 'straightliner' && q.runGroup) {
    if (st.runValue === null) st.runValue = String(rng.int(lo, hi));
    return st.runValue;
  }
  if (st.persona === 'speedster') {
    // Speedsters tend to hit the same end of the scale.
    return String(rng.chance(0.7) ? hi : rng.int(lo, hi));
  }
  if (st.persona === 'imposter') return String(rng.int(lo, hi));
  // Map latent attitude (1–5) onto this scale with noise.
  const t = (st.attitude - 1) / 4;
  const v = lo + t * (hi - lo) + rng.normal(0, (hi - lo) * 0.18);
  return String(clamp(Math.round(v), lo, hi));
}

function choiceAnswer(q: QDef, st: RespondentState, rng: Rng): string[] {
  const options = q.options ?? [];
  const naLike = options.filter((o) => /none of these|not applicable/i.test(o));
  const real = options.filter((o) => !naLike.includes(o));
  if (!q.multi) {
    if (st.persona === 'imposter' && naLike.length && rng.chance(0.75)) return [rng.pick(naLike)];
    if (st.persona === 'speedster')
      return [options[rng.chance(0.6) ? 0 : rng.int(0, options.length - 1)]];
    return [rng.pick(real.length ? real : options)];
  }
  switch (st.persona) {
    case 'mass_selector': {
      const k = Math.max(1, Math.ceil(options.length * rng.float(0.8, 1)));
      const picked = new Set(rng.sample(options, k));
      return options.filter((o) => picked.has(o));
    }
    case 'speedster':
      return [rng.pick(real)];
    case 'imposter':
      return naLike.length && rng.chance(0.7) ? [rng.pick(naLike)] : rng.sample(real, 1);
    default: {
      if (naLike.length && rng.chance(0.05)) return [rng.pick(naLike)];
      const k = rng.int(1, Math.max(1, Math.ceil(real.length * 0.45)));
      const picked = new Set(rng.sample(real, k));
      return real.filter((o) => picked.has(o));
    }
  }
}

function matrixAnswer(q: QDef, st: RespondentState, rng: Rng): Record<string, string[]> {
  const rows = q.rows ?? [];
  const cols = q.columns ?? AGREEMENT;
  const out: Record<string, string[]> = {};
  const flat =
    st.persona === 'speedster' || (st.persona === 'straightliner' && st.matrixStyle === 'flat');
  const zigzag = st.persona === 'straightliner' && st.matrixStyle === 'zigzag';
  const flatCol = rng.int(0, cols.length - 1);
  const zig = rng.chance(0.5) ? [0, cols.length - 1] : [1, cols.length - 2];
  rows.forEach((row, i) => {
    let c: number;
    if (flat) c = flatCol;
    else if (zigzag) c = zig[i % 2];
    else {
      const rowBias = rng.normal(0, 0.6);
      const v = st.attitude + rowBias + rng.normal(0, 0.7);
      c = clamp(Math.round(v) - 1, 0, cols.length - 1);
    }
    out[row] = [cols[c]];
  });
  return out;
}

function cardsortAnswer(q: QDef, st: RespondentState, rng: Rng): Record<string, string[]> {
  const cards = q.cards ?? [];
  const groups = q.groups ?? [];
  if (st.persona === 'random_sorter' || st.persona === 'speedster') {
    const k = rng.int(3, 5);
    const names = rng.chance(0.5)
      ? Array.from({ length: k }, (_, i) => `Group ${i + 1}`)
      : rng.sample(['Stuff', 'Other', 'Misc', 'Tools', 'Things', 'A', 'B', 'C'], k);
    const out: Record<string, string[]> = {};
    for (const n of names) out[n] = [];
    for (const card of rng.shuffle(cards)) out[rng.pick(names)].push(card);
    for (const n of names) if (out[n].length === 0) delete out[n];
    return out;
  }
  // Honest (and imposters, who still sort plausibly): the hidden grouping with 1–3 cards moved,
  // sometimes an extra "not sure" pile, sometimes operations split in two.
  const named = groups.map((g) => ({ name: rng.pick(g.names), cards: g.cards.slice() }));
  if (rng.chance(0.15)) {
    const ops = named[named.length - 1];
    const split = ops.cards.splice(2);
    named.push({ name: rng.pick(['Customers', 'Front of house', 'Sales']), cards: split });
    ops.name = rng.pick(['Stock', 'Supplies', 'Back room']);
  }
  const moves = rng.int(1, 3);
  const extraPile = rng.chance(0.3)
    ? { name: rng.pick(['Not sure', 'Other', 'Admin']), cards: [] as string[] }
    : null;
  for (let m = 0; m < moves; m++) {
    const from = rng.pick(named.filter((g) => g.cards.length > 1));
    const card = from.cards.splice(rng.int(0, from.cards.length - 1), 1)[0];
    if (extraPile && rng.chance(0.6)) extraPile.cards.push(card);
    else rng.pick(named.filter((g) => g !== from)).cards.push(card);
  }
  if (extraPile?.cards.length) named.push(extraPile);
  const out: Record<string, string[]> = {};
  for (const g of named) out[g.name] = g.cards;
  return out;
}

function firstclickAnswer(q: QDef, st: RespondentState, rng: Rng): { top: number; left: number } {
  if (st.persona === 'same_spot_clicker') return { ...st.sameSpot };
  if (st.persona === 'speedster' || rng.chance(0.22)) {
    return { top: round3(rng.float(0.02, 0.98)), left: round3(rng.float(0.02, 0.98)) };
  }
  const t = q.target ?? { top: 0.5, left: 0.5 };
  return {
    top: round3(clamp(t.top + rng.normal(0, 0.05), 0, 1)),
    left: round3(clamp(t.left + rng.normal(0, 0.06), 0, 1)),
  };
}

function buildBlock(spec: SurveySpec, q: QDef, idx: number, st: RespondentState, rng: Rng): Block {
  const base = { blockId: q.id, question: q.question };
  const isOutlier = idx === st.outlierBlock;
  const outlierDuration = () => round1(rng.float(0.8, 1.4));

  switch (q.type) {
    case 'open': {
      const text = openText(spec, q, idx, st, rng);
      return {
        ...base,
        type: 'open',
        duration: openDuration(q, st, rng, text),
        answer: [{ role: 'user', text }],
      };
    }
    case 'scale':
      return {
        ...base,
        type: 'scale',
        duration: isOutlier ? outlierDuration() : duration(q, st, rng),
        answer: scaleAnswer(q, st, rng),
      };
    case 'choice': {
      const answer = choiceAnswer(q, st, rng);
      let d = duration(q, st, rng);
      if (q.multi && st.persona === 'mass_selector')
        d = round1(rng.lognormal(q.typical * 0.45, 0.25));
      if (isOutlier) d = outlierDuration();
      return { ...base, type: 'choice', duration: d, answer, options: q.options };
    }
    case 'matrix': {
      let d = duration(q, st, rng);
      if (st.persona === 'straightliner') d = round1(rng.lognormal(q.typical * 0.7, 0.3));
      if (isOutlier) d = outlierDuration();
      return { ...base, type: 'matrix', duration: d, answer: matrixAnswer(q, st, rng) };
    }
    case 'cardsort': {
      let d = duration(q, st, rng);
      if (st.persona === 'random_sorter') d = round1(rng.lognormal(q.typical * 0.25, 0.3));
      if (isOutlier) d = outlierDuration();
      return { ...base, type: 'cardsort', duration: d, answer: cardsortAnswer(q, st, rng) };
    }
    case 'firstclick': {
      let d = duration(q, st, rng);
      if (st.persona === 'same_spot_clicker') d = round1(rng.float(1.5, 3));
      if (isOutlier) d = outlierDuration();
      return { ...base, type: 'firstclick', duration: d, answer: firstclickAnswer(q, st, rng) };
    }
    case 'prototype': {
      if (q.loadFailArtifact && st.loadFailed) {
        return {
          ...base,
          type: 'prototype',
          duration: round1(rng.float(3, 8)),
          status: 'gave_up',
          clickCount: 0,
        };
      }
      if (st.persona === 'give_upper') {
        return {
          ...base,
          type: 'prototype',
          duration: round1(rng.float(2, 5)),
          status: 'gave_up',
          clickCount: 0,
        };
      }
      if (st.persona === 'speedster') {
        return {
          ...base,
          type: 'prototype',
          duration: duration(q, st, rng, 0.3),
          status: rng.chance(0.6) ? 'partial' : 'gave_up',
          clickCount: rng.int(0, 2),
        };
      }
      const r = rng.float();
      const status = r < 0.7 ? 'completed' : r < 0.9 ? 'partial' : 'gave_up';
      const clickCount = Math.max(
        status === 'gave_up' ? 1 : 3,
        Math.round(rng.lognormal(status === 'completed' ? 9 : 6, 0.45)),
      );
      let d = duration(q, st, rng, 0.45);
      if (status === 'gave_up') d = round1(d * rng.float(0.5, 1.2));
      if (isOutlier) d = outlierDuration();
      return { ...base, type: 'prototype', duration: d, status, clickCount };
    }
    case 'website': {
      if (st.persona === 'give_upper') {
        return { ...base, type: 'website', duration: round1(rng.float(2, 6)), gaveUp: true };
      }
      if (st.persona === 'speedster') {
        return {
          ...base,
          type: 'website',
          duration: duration(q, st, rng, 0.3),
          gaveUp: rng.chance(0.5),
        };
      }
      const gaveUp = rng.chance(0.12);
      let d = duration(q, st, rng, 0.45);
      if (gaveUp) d = round1(d * rng.float(0.4, 0.9));
      if (isOutlier) d = outlierDuration();
      return { ...base, type: 'website', duration: d, gaveUp };
    }
  }
}

// ----------------------------------------------------------------------------
// Responses and surveys
// ----------------------------------------------------------------------------

function screeningAnswers(spec: SurveySpec, rng: Rng): ScreeningAnswer[] | undefined {
  if (!spec.screening) return undefined;
  // Everyone passes screening in this demo; imposters pass it too — that is the coherence fault.
  return spec.screening.map((s) => ({ question: s.question, answer: [rng.pick(s.pass)] }));
}

function personaSequence(spec: SurveySpec, rng: Rng): Persona[] {
  const seq: Persona[] = [];
  for (const [p, n] of Object.entries(spec.personas) as [Persona, number][]) {
    for (let i = 0; i < n; i++) seq.push(p);
  }
  if (seq.length !== RESPONSES_PER_SURVEY) {
    throw new Error(
      `${spec.id}: persona counts sum to ${seq.length}, expected ${RESPONSES_PER_SURVEY}`,
    );
  }
  return rng.shuffle(seq);
}

function buildSurvey(
  spec: SurveySpec,
  rng: Rng,
  truth: Record<string, { persona: Persona; label: QualityLabel }>,
): Survey {
  const personas = personaSequence(spec, rng);
  // UX design artifact: the second prototype fails to load for 12% of honest-like respondents.
  const hasLoadFail = spec.questions.some((q) => q.loadFailArtifact);
  const honestIdx = personas.map((p, i) => (HONEST_LIKE.has(p) ? i : -1)).filter((i) => i >= 0);
  const loadFailVictims = new Set(
    hasLoadFail ? rng.sample(honestIdx, Math.round(RESPONSES_PER_SURVEY * 0.12)) : [],
  );

  const responses: Response[] = personas.map((persona, i) => {
    const id = `${spec.prefix}-${String(i + 1).padStart(3, '0')}`;
    const st = makeState(spec, persona, rng, loadFailVictims.has(i));
    const blocks = spec.questions.map((q, idx) => buildBlock(spec, q, idx, st, rng));
    const screening = screeningAnswers(spec, rng);
    const label = LABELS[persona];
    truth[id] = { persona, label };
    const response: Response = {
      id,
      device: rng.chance(0.45) ? 'mobile' : 'desktop',
      blocks,
      label,
      labelSource: 'auto',
    };
    if (screening) response.screening = screening;
    return response;
  });

  const inventory: InventoryItem[] = [
    ...(spec.screening ?? []).map(
      (s): InventoryItem => ({
        scope: 'screening',
        type: 'choice',
        question: s.question,
        options: s.options,
      }),
    ),
    ...spec.questions.map((q): InventoryItem => {
      const item: InventoryItem = { scope: 'body', type: q.type, question: q.question };
      if (q.options) item.options = q.options;
      return item;
    }),
  ];

  const survey: Survey = { id: spec.id, source: spec.source, inventory, responses };
  if (spec.target) survey.target = spec.target;
  return survey;
}

// ----------------------------------------------------------------------------
// CSV
// ----------------------------------------------------------------------------

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvAnswer(block: Block): string {
  switch (block.type) {
    case 'open': {
      const user = block.answer.filter((t) => t.role === 'user');
      return user.length ? user[user.length - 1].text : '';
    }
    case 'choice':
      return block.answer.join('; ');
    case 'scale':
      return block.answer;
    case 'matrix':
    case 'cardsort':
      return JSON.stringify(block.answer);
    case 'prototype':
      return `${block.status};${block.clickCount}`;
    case 'website':
      return String(block.gaveUp);
    case 'firstclick':
      return `${block.answer.top},${block.answer.left}`;
    case 'other':
      return block.rawAnswer === undefined ? '' : JSON.stringify(block.rawAnswer);
  }
}

function toCsv(dataset: Dataset): string {
  const lines = ['survey_id,response_id,block_id,question_type,question,answer,duration_sec'];
  for (const survey of dataset) {
    for (const response of survey.responses) {
      for (const block of response.blocks) {
        lines.push(
          [
            survey.id,
            response.id,
            block.blockId ?? '',
            block.type,
            block.question,
            csvAnswer(block),
            String(block.duration),
          ]
            .map(csvField)
            .join(','),
        );
      }
    }
  }
  return `${lines.join('\r\n')}\r\n`;
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

function main(): void {
  const rng = new Rng(SEED);
  const truth: Record<string, { persona: Persona; label: QualityLabel }> = {};
  const dataset: Dataset = SURVEYS.map((spec) => buildSurvey(spec, rng, truth));

  // Validate against the runtime contract before writing anything.
  const parsed = parseDataset(JSON.parse(JSON.stringify(dataset)));

  const outDir = dirname(fileURLToPath(import.meta.url));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'demo-dataset.json'), `${JSON.stringify(parsed, null, 2)}\n`);
  writeFileSync(join(outDir, 'demo-ground-truth.json'), `${JSON.stringify(truth, null, 2)}\n`);
  writeFileSync(join(outDir, 'demo-answers.csv'), toCsv(parsed));

  for (const survey of parsed) {
    const counts = new Map<Persona, number>();
    for (const r of survey.responses) {
      const p = truth[r.id].persona;
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    const mix = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([p, n]) => `${p}=${n}`)
      .join(', ');
    console.log(`${survey.id}: ${survey.responses.length} responses — ${mix}`);
  }
  console.log(`wrote demo-dataset.json, demo-ground-truth.json, demo-answers.csv to ${outDir}`);
}

main();
