import {partitionBy} from './utils';

/**
 * `N`-long `contexts` will have `C` `null`s and `N-C` non-null strings. The `null`s represent blanks.
 * Each element of `C`-long `clozes` is a string array of at least one string that is acceptable for that blank.
 * Example:
 * `{contexts: ['hello ', null, null], clozes: [['world', 'everyone', 'down there'], ['!']]}`
 * If available, `hints` should be as long as `clozes` (`C`).
 */
export interface Cloze {
  contexts: (string|null)[], clozes: string[][], hints?: string[],
}

export interface Card {
  prompt: string, responses: string[], pos?: string[], fills?: Cloze[], flashs?: Card[],
}

function separateAtSeparateds(s: string, n: number = 0) {
  if (n) { s = s.slice(n); }
  const adverbMatch = s.match(/\s@\S/);
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
export function blockToCard(block: string[]) {
  const atRe = /^#+\s+@\s+/;
  const match = block[0].match(atRe);
  if (match) {
    const {atSeparatedValues: items, adverbs} = separateAtSeparateds(block[0], match[0].length);
    const [prompt, ...responses] = items;
    let card: Card = {prompt, responses, fills: [], flashs: []};
    for (let line of block.slice(1)) {
      const fillRe = /^-\s+@fill\s+/;
      const flashRe = /^-\s+@\s+/;
      let match = line.match(fillRe);
      if (match) {
        const {atSeparatedValues: fills, adverbs: fillAdverbs} = separateAtSeparateds(line, match[0].length);
        const cloze = parseCloze(prompt, fills[0]);
        // add other valid entries
        cloze.clozes[0].push(...fills.slice(1));
        (card.fills || []).push(cloze); // TypeScript pacification
      } else if (match = line.match(flashRe)) {
        const {atSeparatedValues: items2, adverbs: flashAdverbs} = separateAtSeparateds(line, match[0].length);
        const [prompt2, ...responses2] = items2;
        let flash: Card = {prompt: prompt2, responses: responses2};
        if ('@pos' in flashAdverbs) { flash.pos = flashAdverbs['@pos'].split('-'); }

        // Is the header card is repeated in this bullet? Skip it. A part of speech might be present though
        if (flash.prompt === prompt && responses2.length === responses.length &&
            responses2.join('') === responses.join('')) {
          if (flash.pos && !card.pos) { card.pos = flash.pos; }
          continue;
        }

        // Can I make fill-in-the-blank quizzes out of this flashcard?
        if ('@omit' in flashAdverbs) {
          let cloze = parseCloze(prompt, flashAdverbs['@omit']);
          if (prompt.includes(cloze.clozes[0][0])) { cloze.hints = [prompt2]; }
          cloze.clozes[0] = responses2.concat(prompt2);
          flash.fills = [cloze];
        } else if (prompt.includes(prompt2)) {
          let cloze = parseCloze(prompt, prompt2);
          cloze.clozes[0].push(...responses2);
          cloze.hints = [prompt2];
          flash.fills = [cloze];
        }
        (card.flashs || []).push(flash); // TypeScript pacification
      } else if (line.match(/^\s*-\s+@/)) {
        // Sub-at-bullets and unrecognized at-bullets
      } else {
        // stop looking for @fill/@flash after initial @-bulleted list
        break;
      }
    }
    return card;
  }
  return undefined;
}

export function textToCards(text: string) {
  const re = /^#+\s+.+$/;
  const headers = partitionBy(text.split('\n'), s => re.test(s));
  return headers.map(blockToCard).filter(x => !!x);
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
function parseCloze(haystack: string, needleMaybeContext: string): Cloze {
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
    return {contexts: [left, null, right], clozes: [[cloze]]};
  }
  let cloze = needleMaybeContext;
  let clozeRe = new RegExp(cloze, 'g');
  let clozeHit = clozeRe.exec(haystack);
  if (clozeHit) {
    let left = haystack.slice(0, clozeHit.index);
    let right = haystack.slice(clozeHit.index + cloze.length);
    if (clozeRe.exec(haystack)) { throw new Error('Cloze context required'); }
    return {contexts: [left, null, right], clozes: [[cloze]]};
  }
  throw new Error('Cloze not found');
}