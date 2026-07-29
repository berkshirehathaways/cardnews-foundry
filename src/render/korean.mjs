import { escapeHtml } from "./design.mjs";
import { RenderError } from "./errors.mjs";

const unsafeGlyph = /[\uFFFD\u25A1\u25A0]/u;
const koreanNumber = /^(?:\d+|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉)?|스물(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉)?|서른|마흔|쉰|예순|일흔|여든|아흔)$/u;
const koreanCounter = /^(?:개|명|곳|집|가구|번|봉투|회|마리|권|장|줄|가지)(?:씩|이|가|은|는|을|를|의|도|만|에서)?$/u;
const topic = /(?:은|는|이|가)$/u;
const adnominal = /(?:한|할|하는|된|될|되는|인|일|있는|없는|만든|묶은|적힌|놓인|남은|이어진|빌리는|보는|준|난|돕는|위한|다음|의)$/u;
const connective = /(?:했다고|했기에|됐기에|달랐기에|하지만|있지만|때문에|위해|들어|들여)$/u;
const frequency = /^(?:매일|매주|매달|매년)$/u;
const hangulWord = /^[\p{Script=Hangul}]+$/u;
const publicRoleLabels = new Map([
  ["hook", "핵심"],
  ["context", "변화"],
  ["evidence", "근거"],
  ["insight", "해석"],
  ["closing", "결론"]
]);

const lexical = (value) => value
  .replace(/^[^\p{L}\p{N}]+/gu, "")
  .replace(/[^\p{L}\p{N}]+$/gu, "");

const protectedRanges = (text) => {
  const tokens = [...text.matchAll(/\S+/gu)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    word: lexical(match[0])
  }));
  const ranges = [];
  const countAt = (index) =>
    koreanNumber.test(tokens[index]?.word ?? "") &&
    koreanCounter.test(tokens[index + 1]?.word ?? "");

  for (let index = 0; index < tokens.length; index += 1) {
    if (countAt(index)) ranges.push([index, index + 2]);
    if (
      countAt(index) &&
      tokens[index + 2]?.word === "중" &&
      countAt(index + 3)
    ) ranges.push([index, index + 5]);
    if (frequency.test(tokens[index]?.word ?? "") && countAt(index + 1)) {
      ranges.push([index, index + 3]);
    }
    if (
      topic.test(tokens[index]?.word ?? "") &&
      hangulWord.test(tokens[index + 1]?.word ?? "") &&
      tokens[index + 2]?.word === "아니라"
    ) ranges.push([index, index + 3]);
    if (
      adnominal.test(tokens[index]?.word ?? "") &&
      hangulWord.test(tokens[index + 1]?.word ?? "")
    ) ranges.push([index, index + 2]);
    if (
      connective.test(tokens[index]?.word ?? "") &&
      hangulWord.test(tokens[index + 1]?.word ?? "")
    ) ranges.push([index, index + 2]);
  }

  const byCharacter = ranges
    .map(([start, end]) => [tokens[start].start, tokens[end - 1].end])
    .sort((left, right) => left[0] - right[0] || right[1] - left[1]);
  const merged = [];
  for (const range of byCharacter) {
    const previous = merged.at(-1);
    if (previous !== undefined && range[0] < previous[1]) previous[1] = Math.max(previous[1], range[1]);
    else merged.push(range);
  }
  return merged;
};

export const semanticKoreanHtml = (value) => {
  const text = String(value);
  if (unsafeGlyph.test(text)) {
    throw new RenderError("FONT_GLYPH_UNSAFE", "replacement or tofu marker in semantic text");
  }
  const ranges = protectedRanges(text);
  let cursor = 0;
  let html = "";
  for (const [start, end] of ranges) {
    html += escapeHtml(text.slice(cursor, start)).replaceAll(" ", " <wbr>");
    const phrase = text.slice(start, end);
    html += `<span class="keep-phrase" data-keep-phrase="${escapeHtml(phrase)}">${escapeHtml(phrase)}</span>`;
    cursor = end;
  }
  return html + escapeHtml(text.slice(cursor)).replaceAll(" ", " <wbr>");
};

export const publicKoreanRole = (role) => {
  const label = publicRoleLabels.get(role);
  if (label === undefined) throw new RenderError("ROLE_UNSUPPORTED", role);
  return label;
};
