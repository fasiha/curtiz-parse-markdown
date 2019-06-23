import {partitionBy, zip} from 'curtiz-utils';

/**
 * `N`-long `contexts` will have `C` `null`s and `N-C` non-null strings. The `null`s represent blanks.
 * Each element of `C`-long `clozes` is a string array of at least one string that is acceptable for that blank.
 * Example:
 * `{contexts: ['hello ', null, null], clozes: [['world', 'everyone', 'down there'], ['!']]}`
 * If available, `prompts` should be as long as `clozes` (`C`).
 */
export interface Cloze {
  uniqueId: string;
  kind: ClozeKind;
  contexts: (string|null)[];
  clozes: string[][];
  prompts?: string[];
  translation?: {[lang: string]: string};
}
export type ClozeKind = 'cloze';
type ClozeOptionalId = Omit<Cloze, 'uniqueId'>&{uniqueId?: string};
function addIdToCloze(cloze: ClozeOptionalId): Cloze {
  cloze.uniqueId = JSON.stringify({contexts: cloze.contexts, clozes: cloze.clozes});
  return cloze as Cloze;
}

export interface Card {
  uniqueId: string;
  kind: CardKind;
  prompt: string;
  responses: string[];
  pos?: string[];
  translation?: {[lang: string]: string};
}
export type CardKind = 'card';

export type Quiz = Cloze|Card;

interface Graph<T> {
  edges: Map<string, Set<string>>;
  nodes: Map<string, T>;
}
export type QuizGraph = Graph<Quiz>&{raws: Map<string, Set<string>>};
function emptyGraph(): QuizGraph { return {edges: new Map(), nodes: new Map(), raws: new Map()}; }
function addNode<T>(graph: Graph<T>, node: T, id: string) {
  if (!graph.nodes.has(id)) { graph.nodes.set(id, node); }
}
function addEdge<T>(graph: Graph<T>, parent: T, parentId: string, child: T, childId: string) {
  addNode(graph, parent, parentId);
  addNode(graph, child, childId);
  let set = graph.edges.get(parentId);
  if (set) {
    set.add(childId);
  } else {
    graph.edges.set(parentId, new Set([childId]));
  }
}
function addNodeWithRaw(graph: QuizGraph, raw: string, node: Quiz) {
  addNode(graph, node, node.uniqueId);
  let nodes = graph.raws.get(raw);
  if (nodes) {
    nodes.add(node.uniqueId);
  } else {
    graph.raws.set(raw, new Set([node.uniqueId]));
  }
}

export function _separateAtSeparateds(s: string, n: number = 0) {
  if (n) { s = s.slice(n); }
  const adverbMatch = s.match(/(^|\s)@\S/);
  const adverbIndex = adverbMatch ? adverbMatch.index : s.length;
  const atSeparatedValues = s.slice(0, adverbIndex).split('@').map(s => s.trim());
  const adverbsStrings = adverbMatch ? s.slice(adverbIndex).trim().split('@').filter(s => s).map(s => '@' + s) : [];
  let adverbs: {[name: string]: string} = Object.assign({}, ...adverbsStrings.map(s => {
    const thisMatch = s.match(/@\S+/);
    let ret: {[name: string]: string} = {};
    if (thisMatch) { ret[thisMatch[0]] = s.slice(thisMatch[0].length).trim(); }
    return ret;
  }));
  return {atSeparatedValues, adverbs};
}
export function makeCard(prompt: string, responses: string[]): Card {
  return {prompt, responses, uniqueId: JSON.stringify({prompt, responses}), kind: 'card'};
}
export function updateGraphWithBlock(graph: QuizGraph, block: string[]) {
  const atRe = /^#+\s+@\s+/;
  const match = block[0].match(atRe);
  if (match) {
    const translationRe = /^-\s+@translation\s+/;
    const fillRe = /^-\s+@fill\s+/;
    const flashRe = /^-\s+@\s+/;

    const {atSeparatedValues: items, adverbs} = _separateAtSeparateds(block[0], match[0].length);
    const [prompt, ...responses] = items;
    let card: Card = makeCard(prompt, responses);
    addNodeWithRaw(graph, block[0], card);

    let allFills: Cloze[] = [];
    let allFlashes: Card[] = [];
    let allFlashfillsPromptKanji: Cloze[] = [];
    let allFlashfillsPromptReading: Cloze[] = [];
    let translation: {[lang: string]: string}|undefined = undefined;
    for (const key of Object.keys(adverbs)) {
      if (key.startsWith('@t-')) {
        translation = translation || {};
        translation[key.slice(3)] = adverbs[key];
      }
    }

    for (let line of block.slice(1)) {
      let match: RegExpMatchArray|null;
      if (match = line.match(translationRe)) {
        //
        // Extract translation
        //
        const {atSeparatedValues: _, adverbs: translationAdverbs} = _separateAtSeparateds(line, match[0].length);
        translation = translation || {};
        for (let [k, v] of Object.entries(translationAdverbs)) { translation[k.replace(/^@/, '')] = v; }
        card.translation = translation;
      } else if (match = line.match(fillRe)) {
        //
        // Extract fill in the blank: either particle or conjugated phrase
        //
        const {atSeparatedValues: fills, adverbs: fillAdverbs} = _separateAtSeparateds(line, match[0].length);
        const cloze = parseCloze(prompt, fills[0]);
        // add other valid entries
        cloze.clozes[0].push(...fills.slice(1));
        const node = addIdToCloze(cloze);
        allFills.push(node);
        addNodeWithRaw(graph, block[0] + '\n' + line, node);
      } else if (match = line.match(flashRe)) {
        //
        // Extract flashcard
        //
        const {atSeparatedValues: items2, adverbs: flashAdverbs} = _separateAtSeparateds(line, match[0].length);
        const [prompt2, ...responses2] = items2;
        let flash: Card = makeCard(prompt2, responses2);
        if ('@pos' in flashAdverbs) { flash.pos = flashAdverbs['@pos'].split('-'); }

        // Is the header card is repeated in this bullet? Skip it. A part of speech might be present though
        if (flash.prompt === prompt && responses2.length === responses.length &&
            responses2.join('') === responses.join('')) {
          if (flash.pos && !card.pos) { card.pos = flash.pos; }
          continue;
        }

        allFlashes.push(flash);
        addNodeWithRaw(graph, block[0] + '\n' + line, flash);

        // Can I make fill-in-the-blank quizzes out of this flashcard?
        if ('@omit' in flashAdverbs || prompt.includes(prompt2)) {
          const blank = flashAdverbs['@omit'] || prompt2;
          { // first, make the blank's prompt be prompt2 and the acceptable answers be either prompt2 or responses2
            let cloze = parseCloze(prompt, blank);
            cloze.clozes = [responses2.concat(prompt2)];
            cloze.prompts = [prompt2];
            const node = addIdToCloze(cloze);
            allFlashfillsPromptReading.push(node);
            addNodeWithRaw(graph, block[0] + '\n' + line, node);
          }
          { // next, make the blank prompt be responses2 and the acceptable answer only prompt2
            let cloze = parseCloze(prompt, blank);
            cloze.clozes = [[prompt2]];
            cloze.prompts = [responses2.join('||')];
            const node = addIdToCloze(cloze);
            allFlashfillsPromptKanji.push(node);
            addNodeWithRaw(graph, block[0] + '\n' + line, node);
          }
        }
      } else if (line.match(/^\s*-\s+@/)) {
        // Sub-at-bullets and unrecognized at-bullets
      } else {
        // stop looking for @fill/@flash after initial @-bulleted list
        break;
      }
    }

    // update translation
    if (translation) {
      card.translation = translation;
      for (const list of [allFills, allFlashfillsPromptKanji, allFlashfillsPromptReading]) {
        for (const ent of list) { ent.translation = translation; }
      }
    }

    // All nodes should have been added, along with raws. Now build edges.
    //
    // Studying the card implies everything else was studied too: flashes, fills, and flash-fills
    for (const children of [allFlashes, allFills, allFlashfillsPromptKanji, allFlashfillsPromptReading]) {
      for (const child of children) { addEdge(graph, card, card.uniqueId, child, child.uniqueId); }
    }
    // Studying the flash or fill-flashes implies studying the other.
    for (const [flash, clozeKanji, clozeKana] of zip(allFlashes, allFlashfillsPromptKanji,
                                                     allFlashfillsPromptReading) as
         IterableIterator<[Card, Cloze, Cloze]>) {
      addEdge(graph, flash, flash.uniqueId, clozeKanji, clozeKanji.uniqueId);
      addEdge(graph, flash, flash.uniqueId, clozeKana, clozeKana.uniqueId);
      addEdge(graph, clozeKanji, clozeKanji.uniqueId, flash, flash.uniqueId);
      addEdge(graph, clozeKana, clozeKana.uniqueId, flash, flash.uniqueId);
    }
    // Studying fills or fill-flashes implies studying the card
    for (const fills of [allFills, allFlashfillsPromptKanji, allFlashfillsPromptReading]) {
      for (const fill of fills) { addEdge(graph, fill, fill.uniqueId, card, card.uniqueId); }
    }
  }
}

export function textToGraph(text: string, graph?: QuizGraph) {
  graph = graph || emptyGraph();
  const re = /^#+\s+.+$/;
  const headers = partitionBy(text.split('\n'), s => re.test(s));
  headers.forEach(block => updateGraphWithBlock(graph as QuizGraph, block));
  return graph;
}

/**
 * Given a big string and a substring, which can be either
 * - a strict substring or
 * - a cloze-deleted string like "left[cloze]right", where only "cloze" should be treated as the substring of interest
 * but where "left" and "right" uniquely determine which appearance of "cloze" in the big string is desired,
 *
 * break the big string into two arrays:
 * 1. [the content to the *left* of the substring/cloze, `null`, the content to the *right* of the substring/cloze], and
 * 1. [the substring/cloze].
 *
 * Replacing `null` in the first array with the contents of the second array will yield `haystack` again.
 * @param haystack Long string
 * @param needleMaybeContext
 */
function parseCloze(haystack: string, needleMaybeContext: string): ClozeOptionalId {
  let re = /\[([^\]]+)\]/;
  let bracketMatch = needleMaybeContext.match(re);
  if (bracketMatch) {
    if (typeof bracketMatch.index !== 'number') { throw new Error('TypeScript pacification: match.index invalid'); }
    let cloze = bracketMatch[1];
    let leftContext = needleMaybeContext.slice(0, bracketMatch.index);
    let rightContext = needleMaybeContext.slice(bracketMatch.index + bracketMatch[0].length);
    if (re.test(rightContext)) { throw new Error('More than one context unsupported'); }

    let fullRe = new RegExp(leftContext + cloze + rightContext, 'g');
    let checkContext = fullRe.exec(haystack);
    if (!checkContext) { throw new Error('Failed to find context-and-cloze'); }
    const left = haystack.slice(0, checkContext.index + leftContext.length);
    const right = haystack.slice(checkContext.index + checkContext[0].length - rightContext.length);
    if (fullRe.exec(haystack)) { throw new Error('Insufficient cloze context'); }
    return {contexts: [left, null, right], clozes: [[cloze]], kind: 'cloze'};
  }
  let cloze = needleMaybeContext;
  let clozeRe = new RegExp(cloze, 'g');
  let clozeHit = clozeRe.exec(haystack);
  if (clozeHit) {
    let left = haystack.slice(0, clozeHit.index);
    let right = haystack.slice(clozeHit.index + cloze.length);
    if (clozeRe.exec(haystack)) { throw new Error('Cloze context required'); }
    return {contexts: [left, null, right], clozes: [[cloze]], kind: 'cloze'};
  }
  throw new Error('Cloze not found');
}

if (module === require.main) {
  let s = `# @ 私 @ わたし @ わたくし @ あたし @t-en I @t-fr je @t-de Ich`;
  let graph = textToGraph(s);
  console.dir(graph, {depth: null});
}