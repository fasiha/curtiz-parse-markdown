"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const curtiz_utils_1 = require("curtiz-utils");
const jmdict_furigana_node_1 = require("jmdict-furigana-node");
const matrix_1 = require("./matrix");
var QuizKind;
(function (QuizKind) {
    QuizKind["Cloze"] = "cloze";
    QuizKind["Card"] = "card";
    QuizKind["Match"] = "match";
})(QuizKind = exports.QuizKind || (exports.QuizKind = {}));
function addIdToCloze(cloze) {
    cloze.uniqueId = JSON.stringify({ contexts: cloze.contexts, clozes: cloze.clozes, prompts: cloze.prompts });
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
function makeCard(init) {
    return Object.assign({}, init, { uniqueId: JSON.stringify({ prompt: init.prompt, responses: init.responses, subkind: init.subkind }), kind: QuizKind.Card });
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
const RESPONSE_SEP = '・';
function promptResponsesToCards(prompt, responses) {
    const PASSIVE = makeCard({ prompt, responses, subkind: 'passive' });
    let SEEPROMPT;
    let SEERESPONSE;
    if ((responses.length > 1 || responses[0] !== prompt)) {
        SEEPROMPT = makeCard({ prompt, responses, subkind: 'seePrompt' });
        SEERESPONSE = makeCard({ prompt: responses.join(RESPONSE_SEP), responses: [prompt], subkind: 'seeResponses' });
    }
    return { PASSIVE, SEEPROMPT, SEERESPONSE };
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
    const m = (m) => matrix_1.stringToMatrix(m);
    const SENTENCEMAT = matrix_1.vstack(matrix_1.hstack(...[northwest, north, northeast].map(m)), matrix_1.hstack(...[west, middle, east].map(m)), matrix_1.hstack(...[southwest, south, southeast].map(m)));
    // the 10x10 matrix linking the above 9 with a matching (translation) quiz
    const nineZeros = '0'.repeat(9);
    const vertCol = '110110110'.split('');
    const firstNineRows = vertCol.map(x => nineZeros + x);
    const finalRow = '1110001110';
    const matrixS = firstNineRows.join(' ') + ' ' + finalRow;
    const MATCHMAT = matrix_1.stringToMatrix(matrixS);
    if (MATCHMAT.length !== 10 || MATCHMAT.some(row => row.length !== 10)) {
        throw new Error('wat');
    }
    return { SENTENCEMAT, MATCHMAT };
}
const { SENTENCEMAT, MATCHMAT } = makeGraphMatrix();
function link(graph, matrix, nodes) {
    if (nodes.length !== matrix.length || matrix.some(row => row.length !== nodes.length)) {
        throw new Error('bad graph matrix size');
    }
    for (let parentidx = 0; parentidx < nodes.length; parentidx++) {
        for (let childidx = 0; childidx < nodes.length; childidx++) {
            if (matrix[childidx][parentidx]) {
                addEdgeQuiz(graph, nodes[parentidx], nodes[childidx]);
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
        const headerFields = _separateAtSeparateds(block[0], match[0].length);
        const [prompt, ...responses] = headerFields.atSeparatedValues;
        if (!prompt) {
            throw new Error('no prompt? ' + JSON.stringify(headerFields));
        }
        if (responses.length === 0) {
            responses.push(prompt);
        }
        const { PASSIVE, SEEPROMPT, SEERESPONSE } = promptResponsesToCards(prompt, responses);
        const allCards = [PASSIVE, SEEPROMPT, SEERESPONSE];
        const cards = allCards.filter(x => !!x);
        cards.forEach(card => addNodeWithRaw(graph, block[0], card));
        const acceptableContiguousRegexps = [translationRe, furiganaRe, fillRe, flashRe, unknownRe];
        const bullets = curtiz_utils_1.takeWhile(block.slice(1), line => acceptableContiguousRegexps.some(re => re.test(line)));
        const translation = extractShortTranslation(headerFields.adverbs) || bullets.filter(line => translationRe.test(line)).map(line => {
            const match = line.match(translationRe);
            if (!match) {
                throw new Error('typescript pacification TRANSLATION: ' + line);
            }
            const { adverbs } = _separateAtSeparateds(line, match[0].length);
            const translation = {};
            for (let [k, v] of Object.entries(adverbs)) {
                translation[k.replace(/^@/, '')] = v;
            }
            return translation;
        })[0];
        const furigana = bullets.filter(line => furiganaRe.test(line)).map(line => {
            const match = line.match(furiganaRe);
            if (!match) {
                throw new Error('typescript pacification FURIGANA: ' + line);
            }
            return jmdict_furigana_node_1.stringToFurigana(line.slice(match[0].length));
        })[0];
        if (furigana) {
            cards.forEach(node => node.lede = furigana);
        }
        if (translation) {
            cards.forEach(node => node.translation = translation);
        }
        // might not get the opportunity to link these later
        link(graph, SENTENCEMAT, allCards.concat(Array(6).fill(undefined)));
        const furiganaLookup = [];
        if (furigana) {
            for (const f of furigana) {
                if (typeof f === 'string') {
                    furiganaLookup.push(...f.split(''));
                }
                else {
                    furiganaLookup.push(f.rt);
                }
            }
        }
        const fills = bullets.filter(line => fillRe.test(line)).map(line => {
            const match = line.match(fillRe);
            if (!match) {
                throw new Error('typescript pacification FILL: ' + line);
            }
            const fill = _separateAtSeparateds(line, match[0].length);
            const cloze = parseCloze(prompt, fill.atSeparatedValues[0], 'regular');
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
                throw new Error('typescript pacification FLASH: ' + line);
            }
            const flash = _separateAtSeparateds(line, match[0].length);
            const [prompt2, ...resp2] = flash.atSeparatedValues;
            // These will be morphemes lemma/readings
            const { PASSIVE: subPassive, SEEPROMPT: subPrompt, SEERESPONSE: subResponse } = promptResponsesToCards(prompt2, resp2);
            let allFlashs = [subPassive, subPrompt, subResponse];
            let topFlashs = allFlashs.filter(x => !!x);
            // if this flashcard has a part of speech or furigana
            if ('@furigana' in flash.adverbs) {
                const lede = jmdict_furigana_node_1.stringToFurigana(flash.adverbs['@furigana']);
                topFlashs.forEach(card => card.lede = lede);
            }
            if ('@pos' in flash.adverbs) {
                topFlashs.forEach(card => card.pos = flash.adverbs['@pos'].split('-'));
            }
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
            if (thisTranslation) {
                topFlashs.forEach(card => card.translation = thisTranslation);
            }
            // Now enroll these top-level-equivalent flashcards into the graph
            topFlashs.forEach(card => addNodeWithRaw(graph, block[0] + '\n' + line, card));
            // We delay copying the cards from the node because the above function will merge furigana/translation with any
            // previous card with same uniquID
            topFlashs = topFlashs.map(o => (graph.nodes.get(o.uniqueId) || o));
            allFlashs = allFlashs.map(o => (o ? graph.nodes.get(o.uniqueId) || o : o));
            // Can I make fill-in-the-blank quizzes out of this flashcard?
            let clozeSeeNothing;
            let clozeSeePrompt;
            let clozeSeeResponse;
            if ('@omit' in flash.adverbs || prompt.includes(prompt2)) {
                const blank = flash.adverbs['@omit'] || prompt2;
                // other acceptable alternatives to blank
                const alsoOk = [];
                if (furigana) {
                    const start = prompt.indexOf(blank);
                    if (start >= 0) {
                        const reading = Array.from(Array(blank.length), (_, i) => furiganaLookup[i + start]).join('');
                        alsoOk.push(reading);
                    }
                }
                if (subPassive && subPrompt && subResponse) {
                    // if I can make A', B', C'
                    {
                        const node = parseCloze(prompt, blank, 'noHint');
                        // no prompts, can answer with either prompt or response
                        if (node.clozes[0][0] === prompt2 || resp2.includes(node.clozes[0][0]) || resp2.includes(alsoOk[0])) {
                            alsoOk.push(...resp2.concat(prompt2));
                        }
                        node.clozes[0] = unique(node.clozes[0].concat(alsoOk));
                        clozeSeeNothing = addIdToCloze(node);
                    }
                    {
                        let node = parseCloze(prompt, blank, 'promptHint');
                        // show cloze hint as the prompt
                        node.prompts = [prompt2];
                        // require answer to be responses (or prompt since IME)
                        node.clozes[0] = resp2.concat(prompt2);
                        clozeSeePrompt = addIdToCloze(node);
                    }
                    {
                        let node = parseCloze(prompt, blank, 'responsesHint');
                        node.prompts = [resp2.join(RESPONSE_SEP)];
                        node.clozes[0] = [prompt2];
                        clozeSeeResponse = addIdToCloze(node);
                    }
                }
                else {
                    // Can only make A'
                    let node = parseCloze(prompt, blank, 'noHint');
                    // no prompts, can answer with either prompt or response
                    if (node.clozes[0][0] === prompt2 || resp2.includes(node.clozes[0][0]) || resp2.includes(alsoOk[0])) {
                        alsoOk.push(...resp2.concat(prompt2));
                    }
                    node.clozes[0] = unique(node.clozes[0].concat(alsoOk));
                    clozeSeeNothing = addIdToCloze(node);
                }
            }
            const allClozes = [clozeSeeNothing, clozeSeePrompt, clozeSeeResponse];
            allClozes.forEach(cloze => {
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
            link(graph, SENTENCEMAT, allCards.concat(allFlashs).concat(allClozes));
            return [allFlashs, allClozes];
        });
        // all sub-bullets parsed. Now make matching
        {
            const pairs = [];
            for (const [[passive, ..._], __] of flashs.filter(v => v.length)) {
                if (passive && passive.kind === QuizKind.Card && passive.lede && passive.translation) {
                    pairs.push({ text: passive.lede, translation: passive.translation });
                }
            }
            if (pairs.length) {
                const kind = QuizKind.Match;
                const translation = PASSIVE.translation;
                const lede = PASSIVE.lede;
                const uniqueId = JSON.stringify({ lede, pairs });
                const match = { uniqueId, kind, translation, lede, pairs };
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
function parseCloze(haystack, needleMaybeContext, subkind) {
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
        return { contexts: [left, null, right], clozes: [[cloze]], kind: QuizKind.Cloze, subkind };
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
        return { contexts: [left, null, right], clozes: [[cloze]], kind: QuizKind.Cloze, subkind };
    }
    throw new Error('Cloze not found');
}
function unique(arr) { return Array.from(new Set(arr)); }
//# sourceMappingURL=index.js.map