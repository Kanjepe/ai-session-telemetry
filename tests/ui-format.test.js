import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml,
  fmtCost,
  fmtDuration,
  fmtTokensCompact,
  toolLabel,
} from '../public/js/format.js';

test('toolLabel shortens MCP tool ids and leaves plain tools alone', () => {
  assert.equal(toolLabel('mcp__plugin_playwright_playwright__browser_click'), 'playwright · browser_click');
  assert.equal(toolLabel('mcp__n8n-cloud__get_node'), 'n8n-cloud · get_node');
  assert.equal(toolLabel('Bash'), 'Bash');
  assert.equal(toolLabel(null), '');
});

test('fmtCost scales precision with magnitude', () => {
  assert.equal(fmtCost(0), '$0');
  assert.equal(fmtCost(0.004), '<$0.01');
  assert.equal(fmtCost(3.456), '$3.46');
  assert.equal(fmtCost(42.18), '$42.2');
  assert.equal(fmtCost(1079.6), '$1080');
});

test('fmtTokensCompact uses k / M / B units', () => {
  assert.equal(fmtTokensCompact(999), '999');
  assert.equal(fmtTokensCompact(4_070_000), '4.07M');
  assert.equal(fmtTokensCompact(2_500_000_000), '2.50B');
});

test('fmtDuration renders hours with zero-padded minutes', () => {
  assert.equal(fmtDuration(59), '59s');
  assert.equal(fmtDuration(17 * 3600 + 8 * 60), '17h08');
});

test('escapeHtml neutralises markup', () => {
  assert.equal(escapeHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  assert.equal(escapeHtml(undefined), '');
});
