"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("./utils");
function blockToCard(block) {
    const atRe = /^#+\s+@\s+/;
    const dropAndSplit = (s, n) => s.slice(n).split('@').map(s => s.trim());
    const match = block[0].match(atRe);
    if (match) {
        const items = dropAndSplit(block[0], match[0].length);
        const [prompt, ...responses] = items;
        let card = { prompt, responses, fills: [], flashs: [] };
        for (let line of block.slice(1)) {
            const fillRe = /^- @fill /;
            const flashRe = /^- @flash /;
            let match = line.match(fillRe);
            if (match) {
                const fills = dropAndSplit(line, match[0].length);
                const cloze = parseCloze(prompt, fills[0]);
                // add other valid entries
                cloze.clozes[0].push(...fills.slice(1));
                (card.fills || []).push(cloze); // TypeScript pacification
            }
            else if (match = line.match(flashRe)) {
                const items2 = dropAndSplit(line, match[0].length);
                const [prompt2, ...responses2] = items2;
                (card.flashs || []).push({ prompt: prompt2, responses: responses2 }); // TypeScript pacification
            }
            else {
                // stop looking for @fill/@flash after initial bulleted list
                break;
            }
        }
        return card;
    }
    return undefined;
}
exports.blockToCard = blockToCard;
function textToCards(text) {
    const re = /^#+\s+.+$/;
    const headers = utils_1.partitionBy(text.split('\n'), s => re.test(s));
    return headers.map(blockToCard).filter(x => !!x);
}
exports.textToCards = textToCards;
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
function parseCloze(haystack, needleMaybeContext) {
    let re = /\[([^\]]+)\]/;
    let bracketMatch = needleMaybeContext.match(re);
    if (bracketMatch) {
        if (typeof bracketMatch.index !== 'number') {
            throw new Error('TypeScript pacification: match.index invalid');
        }
        let cloze = bracketMatch[1];
        let leftContext = needleMaybeContext.slice(0, bracketMatch.index);
        let rightContext = needleMaybeContext.slice(bracketMatch.index + bracketMatch[0].length);
        if (re.test(rightContext)) {
            throw new Error('More than one context unsupported');
        }
        let fullRe = new RegExp(leftContext + cloze + rightContext, 'g');
        let checkContext = fullRe.exec(haystack);
        if (!checkContext) {
            throw new Error('Failed to find context-and-cloze');
        }
        const left = haystack.slice(0, checkContext.index + leftContext.length);
        const right = haystack.slice(checkContext.index + checkContext[0].length - rightContext.length);
        if (fullRe.exec(haystack)) {
            throw new Error('Insufficient cloze context');
        }
        return { contexts: [left, null, right], clozes: [[cloze]] };
    }
    let cloze = needleMaybeContext;
    let clozeRe = new RegExp(cloze, 'g');
    let clozeHit = clozeRe.exec(haystack);
    if (clozeHit) {
        let left = haystack.slice(0, clozeHit.index);
        let right = haystack.slice(clozeHit.index + cloze.length);
        if (clozeRe.exec(haystack)) {
            throw new Error('Cloze context required');
        }
        return { contexts: [left, null, right], clozes: [[cloze]] };
    }
    throw new Error('Cloze not found');
}
