"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const curtiz_utils_1 = require("curtiz-utils");
const jmdict_furigana_node_1 = require("jmdict-furigana-node");
const matrix_1 = require("./matrix");
var QuizKind;
(function (QuizKind) {
    QuizKind["Memory"] = "memory";
    QuizKind["Cloze"] = "cloze";
    QuizKind["Card"] = "card";
    QuizKind["Match"] = "match";
})(QuizKind = exports.QuizKind || (exports.QuizKind = {}));
function addIdToCloze(cloze) {
    cloze.uniqueId = JSON.stringify({ contexts: cloze.contexts, clozes: cloze.clozes });
    return cloze;
}
function emptyGraph() { return { edges: new Map(), nodes: new Map(), raws: new Map() }; }
function addNode(graph, node, id) {
    graph.nodes.set(id, Object.assign({}, (graph.nodes.get(id) || {}), node));
}
function addEdge(graph, parent, parentId, child, childId) {
    addNode(graph, parent, parentId);
    addNode(graph, child, childId);
    let set = graph.edges.get(parentId);
    if (set) {
        set.add(childId);
    }
    else {
        graph.edges.set(parentId, new Set([childId]));
    }
}
function addEdgeQuiz(graph, parent, child) {
    if (!parent || !child) {
        return;
    }
    addEdge(graph, parent, parent.uniqueId, child, child.uniqueId);
}
function addNodeWithRaw(graph, raw, node) {
    addNode(graph, node, node.uniqueId);
    let nodes = graph.raws.get(raw);
    if (nodes) {
        nodes.add(node.uniqueId);
    }
    else {
        graph.raws.set(raw, new Set([node.uniqueId]));
    }
}
function addRaw(graph, raw, nodeId) {
    let nodes = graph.raws.get(raw);
    if (nodes) {
        nodes.add(nodeId);
    }
    else {
        graph.raws.set(raw, new Set([nodeId]));
    }
}
function _separateAtSeparateds(s, n = 0) {
    if (n) {
        s = s.slice(n);
    }
    const adverbMatch = s.match(/(^|\s)@\S/);
    const adverbIndex = adverbMatch ? adverbMatch.index : s.length;
    const atSeparatedValues = s.slice(0, adverbIndex).split('@').map(s => s.trim());
    const adverbsStrings = adverbMatch ? s.slice(adverbIndex).trim().split('@').filter(s => s).map(s => '@' + s) : [];
    let adverbs = Object.assign({}, ...adverbsStrings.map(s => {
        const thisMatch = s.match(/@\S+/);
        let ret = {};
        if (thisMatch) {
            ret[thisMatch[0]] = s.slice(thisMatch[0].length).trim();
        }
        return ret;
    }));
    return { atSeparatedValues, adverbs };
}
exports._separateAtSeparateds = _separateAtSeparateds;
function makeCard(prompt, responses, remember) {
    return { prompt, responses, uniqueId: JSON.stringify({ prompt, responses, remember }), kind: QuizKind.Card, remember };
}
exports.makeCard = makeCard;
function extractShortTranslation(adverbs) {
    let translation = undefined;
    for (const key of Object.keys(adverbs)) {
        if (key.startsWith('@t-')) {
            translation = translation || {};
            translation[key.slice(3)] = adverbs[key];
        }
    }
    return translation;
}
function groupBy(arr, f) {
    const ret = new Map();
    for (const x of arr) {
        const y = f(x);
        const hit = ret.get(y);
        if (hit) {
            hit.push(x);
        }
        else {
            ret.set(y, [x]);
        }
    }
    return ret;
}
const RESPONSE_SEP = '・';
function promptResponsesToCards(prompt, responses) {
    const PASSIVE = makeCard(prompt, responses, true);
    let SEEPROMPT;
    let SEERESPONSE;
    if ((responses.length > 1 || responses[0] !== prompt)) {
        SEEPROMPT = makeCard(prompt, responses, false);
        SEERESPONSE = makeCard(responses.join(RESPONSE_SEP), [prompt], false);
    }
    return { PASSIVE, SEEPROMPT, SEERESPONSE };
}
function makeGraphMatrix() {
    const northwest = '011 101 000';
    const north = '000 000 000';
    const northeast = '111 111 000';
    const west = '111 111 001';
    const middle = '011 101 000';
    const east = '111 111 001';
    const southwest = '111 111 001';
    const south = '000 111 001';
    const southeast = '011 101 000';
    const m = (m) => matrix_1.stringToMatrix(m);
    return matrix_1.vstack(matrix_1.hstack(...[northwest, north, northeast].map(m)), matrix_1.hstack(...[west, middle, east].map(m)), matrix_1.hstack(...[southwest, south, southeast].map(m)));
}
const GRAPHMATRIX = makeGraphMatrix();
function link(graph, sentenceCards, vocabCards, clozes) {
    const [sa, sb, sc] = sentenceCards;
    const [a, b, c] = vocabCards;
    const [ca, cb, cc] = clozes;
    const all = [sa, sb, sc, a, b, c, ca, cb, cc];
    if (all.length !== GRAPHMATRIX.length || all.length !== GRAPHMATRIX[0].length) {
        throw new Error('bad graph matrix size');
    }
    for (let parentidx = 0; parentidx < all.length; parentidx++) {
        for (let childidx = 0; childidx < all.length; childidx++) {
            if (GRAPHMATRIX[childidx][parentidx]) {
                addEdgeQuiz(graph, all[parentidx], all[childidx]);
            }
        }
    }
}
function updateGraphWithBlock(graph, block) {
    const atRe = /^#+\s+@\s+/;
    const match = block[0].match(atRe);
    if (match) {
        const translationRe = /^-\s+@translation\s+/;
        const furiganaRe = /^-\s+@furigana\s+/;
        const fillRe = /^-\s+@fill\s+/;
        const flashRe = /^-\s+@\s+/;
        const unknownRe = /^\s*-\s+@/;
        const headerFields = _separateAtSeparateds(block[0]);
        const [prompt, ...responses] = headerFields.atSeparatedValues;
        if (!prompt) {
            throw new Error('no prompt? ' + JSON.stringify(headerFields));
        }
        if (responses.length === 0) {
            responses.push(prompt);
        }
        const { PASSIVE, SEEPROMPT, SEERESPONSE } = promptResponsesToCards(prompt, responses);
        const cards = [PASSIVE, SEEPROMPT, SEERESPONSE].filter(x => !!x);
        const acceptableContiguousRegexps = [translationRe, furiganaRe, fillRe, flashRe, unknownRe];
        const bullets = curtiz_utils_1.takeWhile(block.slice(1), line => acceptableContiguousRegexps.some(re => re.test(line)));
        const translation = extractShortTranslation(headerFields.adverbs) || bullets.filter(line => translationRe.test(line)).map(line => {
            const match = line.match(translationRe);
            if (!match) {
                throw new Error('typescript pacification: ' + line);
            }
            const { adverbs } = _separateAtSeparateds(line, match[0].length);
            const translation = {};
            for (let [k, v] of Object.entries(adverbs)) {
                translation[k.replace(/^@/, '')] = v;
            }
            return translation;
        })[0];
        const furigana = bullets.filter(line => furiganaRe.test(line)).map(line => {
            const match = line.match(fillRe);
            if (!match) {
                throw new Error('typescript pacification: ' + line);
            }
            return jmdict_furigana_node_1.stringToFurigana(line.slice(match[0].length));
        })[0];
        if (furigana) {
            cards.forEach(node => node.lede = furigana);
        }
        if (translation) {
            cards.forEach(node => node.translation = translation);
        }
        const fills = bullets.filter(line => fillRe.test(line)).map(line => {
            const match = line.match(fillRe);
            if (!match) {
                throw new Error('typescript pacification: ' + line);
            }
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
            if (furigana) {
                node.lede = furigana;
            }
            if (translation) {
                node.translation = translation;
            }
            return node;
        });
        const flashs = bullets.filter(line => flashRe.test(line)).map(line => {
            const match = line.match(flashRe);
            if (!match) {
                throw new Error('typescript pacification: ' + line);
            }
            const flash = _separateAtSeparateds(line, match[0].length);
            const [prompt2, ...resp2] = flash.atSeparatedValues;
            const { PASSIVE: subPassive, SEEPROMPT: subPrompt, SEERESPONSE: subResponse } = promptResponsesToCards(prompt2, resp2);
            const topFlashs = [subPassive, subPrompt, subResponse].filter(x => !!x);
            // if this flashcard has a part of speech
            if ('@pos' in flash.adverbs) {
                topFlashs.forEach(card => card.pos = flash.adverbs['@pos'].split('-'));
            }
            // Is the header card is repeated in this bullet? Skip it.
            if (prompt2 === prompt && resp2.length === responses.length && resp2.join('') === responses.join('')) {
                if (!cards[0].pos && topFlashs[0].pos) {
                    cards.forEach(card => card.pos = flash.adverbs.pos.split('-'));
                }
                return;
            }
            // if local translation available
            const thisTranslation = extractShortTranslation(flash.adverbs);
            if (thisTranslation) {
                topFlashs.forEach(card => card.translation = thisTranslation);
            }
            // Now enroll these top-level-equivalent flashcards into the graph
            topFlashs.forEach(card => addNodeWithRaw(graph, block[0] + '\n' + line, card));
            // Can I make fill-in-the-blank quizzes out of this flashcard?
            let clozeSeeNothing;
            let clozeSeePrompt;
            let clozeSeeResponse;
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
                }
                else {
                    // Can only make A'
                    let node = parseCloze(prompt, blank);
                    // no prompts, can answer with either prompt or response
                    node.clozes[0] = resp2.concat(prompt2);
                    clozeSeeNothing = addIdToCloze(node);
                }
            }
            const clozes = [clozeSeeNothing, clozeSeePrompt, clozeSeeResponse];
            clozes.forEach(cloze => {
                if (cloze) {
                    addNodeWithRaw(graph, block[0] + '\n' + line, cloze);
                    if (translation) {
                        cloze.translation = translation;
                    }
                    if (furigana) {
                        cloze.lede = furigana;
                    }
                }
            });
            link(graph, cards, topFlashs, clozes);
        });
        for (const line of block.slice(1)) {
            let match;
            if (match = line.match(fillRe)) {
                /****************************
                 * Extract fill in the blank: either particle or conjugated phrase
                 ***************************/
            }
            else if (match = line.match(flashRe)) {
            }
            else if (line.match(unknownRe)) {
                // Sub-at-bullets and unrecognized at-bullets
            }
            else {
                // stop looking for @fill/@flash after initial @-bulleted list
                break;
            }
        }
    }
}
exports.updateGraphWithBlock = updateGraphWithBlock;
function textToGraph(text, graph) {
    graph = graph || emptyGraph();
    const re = /^#+\s+.+$/;
    const headers = curtiz_utils_1.partitionBy(text.split('\n'), s => re.test(s));
    headers.forEach(block => updateGraphWithBlock(graph, block));
    return graph;
}
exports.textToGraph = textToGraph;
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
        return { contexts: [left, null, right], clozes: [[cloze]], kind: QuizKind.Cloze };
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
        return { contexts: [left, null, right], clozes: [[cloze]], kind: QuizKind.Cloze };
    }
    throw new Error('Cloze not found');
}
if (module === require.main) {
    let s = `# @ 私 @ わたし @ わたくし @ あたし @t-en I @t-fr je @t-de Ich`;
    let graph = textToGraph(s);
    console.dir(graph, { depth: null });
}
//# sourceMappingURL=index.js.map