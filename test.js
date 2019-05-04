"use strict";
const curtiz = require('./index');
const test = require('tape');
test('does not do anything for non-headers', t => {
  let s = `## blabla
- @fill に
`;
  t.notOk(curtiz.blockToCard(s.split('\n')));
  t.end();
});