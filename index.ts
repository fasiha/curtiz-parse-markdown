import {flatten, hasKanji, partitionBy, takeWhile, zip} from 'curtiz-utils';
import {Furigana, stringToFurigana} from 'jmdict-furigana-node';

import {hstack, Matrix, stringToMatrix, vstack} from './matrix';

export enum QuizKind {
  Cloze = 'cloze',
  Card = 'card',
  Match = 'match',
}
interface QuizBase {
  uniqueId: string;
  kind: QuizKind;
  translation?: {[lang: string]: string};
  lede?: Furigana[];
}

type Dict = {
  [name: string]: string
};
export type MatchPiece = {
  text: Furigana[],
  translation: Dict
};
export interface QuizMatch extends QuizBase {
  pairs: MatchPiece[];
  kind: QuizKind.Match;
}

/**
 * `N`-long `contexts` will have `C` `null`s and `N-C` non-null strings. The `null`s represent blanks.
 * Each element of `C`-long `clozes` is a string array of at least one string that is acceptable for that blank.
 * Example:
 * `{contexts: ['hello ', null, null], clozes: [['world', 'everyone', 'down there'], ['!']]}`
 * If available, `prompts` should be as long as `clozes` (`C`).
 */
export interface QuizCloze extends QuizBase {
  contexts: (string|null)[];
  clozes: string[][];
  kind: QuizKind.Cloze;
  prompts?: string[];
}
type ClozeOptionalId = Omit<QuizCloze, 'uniqueId'>&{uniqueId?: string};
function addIdToCloze(cloze: ClozeOptionalId): QuizCloze {
  cloze.uniqueId = JSON.stringify({contexts: cloze.contexts, clozes: cloze.clozes, prompts: cloze.prompts});
  return cloze as QuizCloze;
}

export interface QuizCard extends QuizBase {
  prompt: string;
  responses: string[];
  kind: QuizKind.Card;
  passive: boolean;
  inverted: boolean;
  pos?: string[];
}

export type Quiz = QuizCloze|QuizCard|QuizMatch;

interface Graph<T> {
  edges: Map<string, Set<string>>;
  nodes: Map<string, T>;
}
export type QuizGraph = Graph<Quiz>&{raws: Map<string, Set<string>>};
function emptyGraph(): QuizGraph { return {edges: new Map(), nodes: new Map(), raws: new Map()}; }
function addNode<T>(graph: Graph<T>, node: T, id: string) {
  graph.nodes.set(id, {...(graph.nodes.get(id) || {}), ...node});
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
function addEdgeQuiz<T extends QuizBase>(graph: Graph<T>, parent: T|undefined, child: T|undefined) {
  if (!parent || !child) { return; }
  addEdge(graph, parent, parent.uniqueId, child, child.uniqueId);
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

function addRaw(graph: QuizGraph, raw: string, nodeId: string) {
  let nodes = graph.raws.get(raw);
  if (nodes) {
    nodes.add(nodeId);
  } else {
    graph.raws.set(raw, new Set([nodeId]));
  }
}

type AtLine = {
  atSeparatedValues: string[],
  adverbs: {[name: string]: string;},
};
export function _separateAtSeparateds(s: string, n: number = 0): AtLine {
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
export function makeCard(prompt: string, responses: string[], passive: boolean, inverted: boolean): QuizCard {
  return {
    prompt,
    responses,
    uniqueId: JSON.stringify({prompt, responses, passive}),
    kind: QuizKind.Card,
    passive,
    inverted
  };
}

function extractShortTranslation(adverbs: Dict): Dict|undefined {
  let translation: Dict|undefined = undefined;
  for (const key of Object.keys(adverbs)) {
    if (key.startsWith('@t-')) {
      translation = translation || {};
      translation[key.slice(3)] = adverbs[key];
    }
  }
  return translation;
}

const RESPONSE_SEP = '・'
function promptResponsesToCards(prompt: string, responses: string[]) {
  const passiveconstant = true;
  const invertedconstant = true;
  const PASSIVE = makeCard(prompt, responses, passiveconstant, !invertedconstant);
  let SEEPROMPT: QuizCard|undefined;
  let SEERESPONSE: QuizCard|undefined;
  if ((responses.length > 1 || responses[0] !== prompt)) {
    SEEPROMPT = makeCard(prompt, responses, !passiveconstant, !invertedconstant);
    SEERESPONSE = makeCard(responses.join(RESPONSE_SEP), [prompt], !passiveconstant, invertedconstant);
  }

  return {PASSIVE, SEEPROMPT, SEERESPONSE};
}

function makeGraphMatrix() {
  // 9x9 linking sentence flashcards, sub-sentence vocab flashcards, and vocab-cloze-deleted quizzes
  const northwest = '011 101 000';
  const north = '000 000 000';
  const northeast = '111 111 000';
  const west = '111 111 001';
  const middle = '011 101 000';
  const east = '111 111 001';
  const southwest = '111 111 001';
  const south = '000 111 001';
  const southeast = '011 101 000';
  const m = (m: string) => stringToMatrix(m);
  const SENTENCEMAT = vstack(
      hstack(...[northwest, north, northeast].map(m)),
      hstack(...[west, middle, east].map(m)),
      hstack(...[southwest, south, southeast].map(m)),
  );

  // the 10x10 matrix linking the above 9 with a matching (translation) quiz
  const nineZeros = '0'.repeat(9);
  const vertCol = '110110110'.split('');
  const firstNineRows = vertCol.map(x => nineZeros + x);
  const finalRow = '1110001110'
  const matrixS = firstNineRows.join(' ') + ' ' + finalRow;
  const MATCHMAT = stringToMatrix(matrixS);
  if (MATCHMAT.length !== 10 || MATCHMAT.some(row => row.length !== 10)) { throw new Error('wat'); }

  return {SENTENCEMAT, MATCHMAT};
}

const {SENTENCEMAT, MATCHMAT} = makeGraphMatrix();

function link(graph: QuizGraph, matrix: number[][], nodes: (Quiz|undefined)[]) {
  if (nodes.length !== matrix.length || matrix.some(row => row.length !== nodes.length)) {
    throw new Error('bad graph matrix size');
  }
  for (let parentidx = 0; parentidx < nodes.length; parentidx++) {
    for (let childidx = 0; childidx < nodes.length; childidx++) {
      if (matrix[childidx][parentidx]) {
        if (nodes[parentidx] && nodes[childidx]) {
          // console.log({par: (nodes[parentidx] as any).uniqueId, chil: (nodes[childidx] as any).uniqueId});
        }
        addEdgeQuiz(graph, nodes[parentidx], nodes[childidx]);
      }
    }
  }
}

export function updateGraphWithBlock(graph: QuizGraph, block: string[]) {
  const atRe = /^#+\s+@\s+/;
  const match = block[0].match(atRe);
  if (match) {
    const translationRe = /^-\s+@translation\s+/;
    const furiganaRe = /^-\s+@furigana\s+/;
    const fillRe = /^-\s+@fill\s+/;
    const flashRe = /^-\s+@\s+/;
    const unknownRe = /^\s*-\s+@/;

    const headerFields: AtLine = _separateAtSeparateds(block[0], match[0].length);
    const [prompt, ...responses] = headerFields.atSeparatedValues;
    if (!prompt) { throw new Error('no prompt? ' + JSON.stringify(headerFields)); }
    if (responses.length === 0) { responses.push(prompt); }
    const {PASSIVE, SEEPROMPT, SEERESPONSE} = promptResponsesToCards(prompt, responses);
    const allCards = [PASSIVE, SEEPROMPT, SEERESPONSE];
    const cards: QuizCard[] = allCards.filter(x => !!x) as QuizCard[];
    cards.forEach(card => addNodeWithRaw(graph, block[0], card));

    const acceptableContiguousRegexps = [translationRe, furiganaRe, fillRe, flashRe, unknownRe];
    const bullets = takeWhile(block.slice(1), line => acceptableContiguousRegexps.some(re => re.test(line)));

    const translation: Dict|undefined =
        extractShortTranslation(headerFields.adverbs) || bullets.filter(line => translationRe.test(line)).map(line => {
          const match = line.match(translationRe);
          if (!match) { throw new Error('typescript pacification TRANSLATION: ' + line); }
          const {adverbs} = _separateAtSeparateds(line, match[0].length);
          const translation: Dict = {};
          for (let [k, v] of Object.entries(adverbs)) { translation[k.replace(/^@/, '')] = v; }
          return translation;
        })[0];
    const furigana: Furigana[]|undefined = bullets.filter(line => furiganaRe.test(line)).map(line => {
      const match = line.match(furiganaRe);
      if (!match) { throw new Error('typescript pacification FURIGANA: ' + line); }
      return stringToFurigana(line.slice(match[0].length))
    })[0];

    if (furigana) { cards.forEach(node => node.lede = furigana); }
    if (translation) { cards.forEach(node => node.translation = translation); }
    // might not get the opportunity to link these later
    link(graph, SENTENCEMAT, allCards.concat(Array(6).fill(undefined)));

    const fills = bullets.filter(line => fillRe.test(line)).map(line => {
      const match = line.match(fillRe);
      if (!match) { throw new Error('typescript pacification FILL: ' + line); }
      const fill = _separateAtSeparateds(line, match[0].length);
      const cloze = parseCloze(prompt, fill.atSeparatedValues[0]);
      // add other valid entries
      cloze.clozes[0].push(...fill.atSeparatedValues.slice(1));
      // complete the graph node
      const node = addIdToCloze(cloze);
      addNodeWithRaw(graph, block[0] + '\n' + line, node);
      for (const card of cards) {
        addEdgeQuiz(graph, card, node);
        addEdgeQuiz(graph, node, card); // flipped
      }
      if (furigana) { node.lede = furigana; }
      if (translation) { node.translation = translation; }
      return node;
    });

    const flashs = bullets.filter(line => flashRe.test(line)).map(line => {
      const match = line.match(flashRe);
      if (!match) { throw new Error('typescript pacification FLASH: ' + line); }

      const flash = _separateAtSeparateds(line, match[0].length);
      const [prompt2, ...resp2] = flash.atSeparatedValues;
      const {PASSIVE: subPassive, SEEPROMPT: subPrompt, SEERESPONSE: subResponse} =
          promptResponsesToCards(prompt2, resp2);

      const allFlashs = [subPassive, subPrompt, subResponse];
      const topFlashs = allFlashs.filter(x => !!x) as QuizCard[];

      // if this flashcard has a part of speech or furigana
      if ('@furigana' in flash.adverbs) {
        const lede = stringToFurigana(flash.adverbs['@furigana']);
        topFlashs.forEach(card => card.lede = lede);
      }
      if ('@pos' in flash.adverbs) { topFlashs.forEach(card => card.pos = flash.adverbs['@pos'].split('-')); }

      // Is the header card is repeated in this bullet? Skip it.
      if (prompt2 === prompt && resp2.length === responses.length && resp2.join('') === responses.join('')) {
        if (!cards[0].pos && topFlashs[0].pos) {
          cards.forEach(card => {
            card.pos = topFlashs[0].pos;
            addNodeWithRaw(graph, block[0], card); // merge pos
          });
        }
        return [];
      }

      // if local translation available
      const thisTranslation = extractShortTranslation(flash.adverbs);
      if (thisTranslation) { topFlashs.forEach(card => card.translation = thisTranslation); }

      // Now enroll these top-level-equivalent flashcards into the graph
      topFlashs.forEach(card => addNodeWithRaw(graph, block[0] + '\n' + line, card));

      // Can I make fill-in-the-blank quizzes out of this flashcard?
      let clozeSeeNothing: QuizCloze|undefined;
      let clozeSeePrompt: QuizCloze|undefined;
      let clozeSeeResponse: QuizCloze|undefined;
      if ('@omit' in flash.adverbs || prompt.includes(prompt2)) {
        const blank = flash.adverbs['@omit'] || prompt2;

        if (subPassive && subPrompt && subResponse) {
          // if I can make A', B', C'
          {
            const node = parseCloze(prompt, blank);
            // no prompts, can answer with either prompt or response
            node.clozes[0] = resp2.concat(prompt2);
            clozeSeeNothing = addIdToCloze(node);
          }
          {
            let node = parseCloze(prompt, blank);
            // show cloze hint as the prompt
            node.prompts = [prompt2];
            // require answer to be responses (or prompt since IME)
            node.clozes[0] = resp2.concat(prompt2);
            clozeSeePrompt = addIdToCloze(node);
          }
          {
            let node = parseCloze(prompt, blank);
            node.prompts = [resp2.join(RESPONSE_SEP)];
            node.clozes[0] = [prompt2];
            clozeSeeResponse = addIdToCloze(node);
          }
        } else {
          // Can only make A'
          let node = parseCloze(prompt, blank);
          // no prompts, can answer with either prompt or response
          node.clozes[0] = resp2.concat(prompt2);
          clozeSeeNothing = addIdToCloze(node);
        }
      }

      const allClozes = [clozeSeeNothing, clozeSeePrompt, clozeSeeResponse];
      allClozes.forEach(cloze => {
        if (cloze) {
          addNodeWithRaw(graph, block[0] + '\n' + line, cloze);
          if (translation) { cloze.translation = translation; }
          if (furigana) { cloze.lede = furigana; }
        }
      });
      link(graph, SENTENCEMAT, (cards as (Quiz | undefined)[]).concat(topFlashs).concat(allClozes));
      return [allFlashs, allClozes];
    });

    // all sub-bullets parsed. Now make matching
    {
      const pairs = [] as MatchPiece[];
      for (const [[passive, ..._], __] of flashs.filter(v => v.length)) {
        if (passive && passive.kind === QuizKind.Card && passive.lede && passive.translation) {
          pairs.push({text: passive.lede, translation: passive.translation})
        }
      }
      if (pairs.length) {
        const kind = QuizKind.Match;
        const translation = PASSIVE.translation;
        const lede = PASSIVE.lede;
        const uniqueId = JSON.stringify({lede, pairs});
        const match: QuizMatch = {uniqueId, kind, translation, lede, pairs};
        addNodeWithRaw(graph, block[0], match);

        // reviewing any of the top cards (promt<->resp) is a passive review for this match card
        // reviewing the match is passive review for the top-level passive/show-prompt
        //
        for (const [[a, b, c], [ap, bp, cp]] of flashs) {
          const ten = [cards[0], cards[1], cards[2], a, b, c, ap, bp, cp, match];
          link(graph, MATCHMAT, ten);
        }
      }
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
    return {contexts: [left, null, right], clozes: [[cloze]], kind: QuizKind.Cloze};
  }
  let cloze = needleMaybeContext;
  let clozeRe = new RegExp(cloze, 'g');
  let clozeHit = clozeRe.exec(haystack);
  if (clozeHit) {
    let left = haystack.slice(0, clozeHit.index);
    let right = haystack.slice(clozeHit.index + cloze.length);
    if (clozeRe.exec(haystack)) { throw new Error('Cloze context required'); }
    return {contexts: [left, null, right], clozes: [[cloze]], kind: QuizKind.Cloze};
  }
  throw new Error('Cloze not found');
}

if (module === require.main) {
  let s = `# @ 私 @ わたし @ わたくし @ あたし @t-en I @t-fr je @t-de Ich`;
  let graph = textToGraph(s);
  console.dir(graph, {depth: null});
}