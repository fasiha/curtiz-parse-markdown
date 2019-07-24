import {flatten} from 'curtiz-utils';

export type Matrix = number[][];
export type StringToMatrixOpts = {
  rowSplit?: RegExp|string,
  colSplit?: RegExp|string,
  parser?: (s: string) => number
};
export function stringToMatrix(s: string, opts: StringToMatrixOpts = {}): Matrix {
  const rowSplit = opts.rowSplit || /\s+/;
  const colSplit = opts.colSplit || '';
  const parser = opts.parser || parseInt;
  const mat = s.split(rowSplit).map(line => line.split(colSplit).map(x => parser(x)));
  const width = mat[0].length;
  if (mat.some(row => row.length !== width)) { throw new Error('ragged matrix'); }
  return mat;
}
export function matrixCopy(m: Matrix): Matrix {
  const ret: Matrix = [];
  m.forEach(v => ret.push(v.slice()));
  return ret;
}
export function matrixWidth(m: Matrix): number { return m[0].length; }
export function matrixHeight(m: Matrix): number { return m.length; }
export function hstack(...arrs: Matrix[]): Matrix {
  const height = matrixHeight(arrs[0]);
  if (arrs.some(arr => matrixHeight(arr) !== height)) { throw new Error('cannot hstack uneven heights'); }
  return Array.from(Array(height), (_, rowid) => flatten(arrs.map(arr => arr[rowid])));
}
export function vstack(...arrs: Matrix[]): Matrix {
  const width = matrixWidth(arrs[0]);
  if (arrs.some(arr => matrixWidth(arr) !== width)) { throw new Error('cannot vstack uneven widths'); }
  return flatten(arrs);
}

if (module === require.main) {
  const northwest = '011 101 000';
  const north = '000 000 000';
  const northeast = '111 111 000';
  const west = '111 111 001';
  const middle = '011 101 000';
  const east = '111 111 001';
  console.log(stringToMatrix(northwest));
  console.log(hstack(...[northwest, north, northeast].map(m => stringToMatrix(m))))
  console.log(vstack(
      hstack(...[northwest, north, northeast].map(m => stringToMatrix(m))),
      hstack(...[west, middle, east].map(m => stringToMatrix(m))),
      // hstack(...[northwest, north, northeast].map(m => stringToMatrix(m))),
      ));
}
