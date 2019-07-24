"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const curtiz_utils_1 = require("curtiz-utils");
function stringToMatrix(s, opts = {}) {
    const rowSplit = opts.rowSplit || /\s+/;
    const colSplit = opts.colSplit || '';
    const parser = opts.parser || parseInt;
    const mat = s.split(rowSplit).map(line => line.split(colSplit).map(x => parser(x)));
    const width = mat[0].length;
    if (mat.some(row => row.length !== width)) {
        throw new Error('ragged matrix');
    }
    return mat;
}
exports.stringToMatrix = stringToMatrix;
function matrixCopy(m) {
    const ret = [];
    m.forEach(v => ret.push(v.slice()));
    return ret;
}
exports.matrixCopy = matrixCopy;
function matrixWidth(m) { return m[0].length; }
exports.matrixWidth = matrixWidth;
function matrixHeight(m) { return m.length; }
exports.matrixHeight = matrixHeight;
function hstack(...arrs) {
    const height = matrixHeight(arrs[0]);
    if (arrs.some(arr => matrixHeight(arr) !== height)) {
        throw new Error('cannot hstack uneven heights');
    }
    return Array.from(Array(height), (_, rowid) => curtiz_utils_1.flatten(arrs.map(arr => arr[rowid])));
}
exports.hstack = hstack;
function vstack(...arrs) {
    const width = matrixWidth(arrs[0]);
    if (arrs.some(arr => matrixWidth(arr) !== width)) {
        throw new Error('cannot vstack uneven widths');
    }
    return curtiz_utils_1.flatten(arrs);
}
exports.vstack = vstack;
if (module === require.main) {
    const northwest = '011 101 000';
    const north = '000 000 000';
    const northeast = '111 111 000';
    const west = '111 111 001';
    const middle = '011 101 000';
    const east = '111 111 001';
    console.log(stringToMatrix(northwest));
    console.log(hstack(...[northwest, north, northeast].map(m => stringToMatrix(m))));
    console.log(vstack(hstack(...[northwest, north, northeast].map(m => stringToMatrix(m))), hstack(...[west, middle, east].map(m => stringToMatrix(m)))));
}
//# sourceMappingURL=matrix.js.map