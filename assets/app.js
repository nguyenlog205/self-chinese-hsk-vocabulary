// Loads vocab/*.csv at runtime, renders the level mosaic, and wires up the
// flashcard overlay + search box. Requires being served over http(s)
// (GitHub Pages, `python -m http.server`, ...) since fetch() can't read
// local files over file://.

const LEVELS = [
  { label: "H1", csv: "vocab/hsk_level_01.csv", audioDir: "H1", column: 1, cols: 50, hueLight: [42, 120, 214], hueDark: [57, 135, 229] },
  { label: "H2", csv: "vocab/hsk_level_02.csv", audioDir: "H2", column: 1, cols: 50, hueLight: [27, 175, 122], hueDark: [25, 158, 112] },
  { label: "H3", csv: "vocab/hsk_level_03.csv", audioDir: "H3", column: 1, cols: 50, hueLight: [237, 161, 0], hueDark: [201, 133, 0] },
  { label: "H4", csv: "vocab/hsk_level_04.csv", audioDir: "H4", column: 1, cols: 50, hueLight: [0, 131, 0], hueDark: [0, 131, 0] },
  { label: "H5", csv: "vocab/hsk_level_05.csv", audioDir: "H5", column: 1, cols: 50, hueLight: [74, 58, 167], hueDark: [144, 133, 233] },
  { label: "H6", csv: "vocab/hsk_level_06.csv", audioDir: "H6", column: 2, cols: 100, hueLight: [227, 73, 72], hueDark: [230, 103, 103] },
  { label: "HSK 7–9", csv: "vocab/hsk_level_07_09.csv", audioDir: "H7-9", column: 2, cols: 100, hueLight: [232, 123, 164], hueDark: [213, 81, 129] },
];

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r") {
      // skip
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}

async function loadLevel(level) {
  const text = await (await fetch(level.csv)).text();
  const [, ...rows] = parseCSV(text); // drop header row
  return rows.map(([word, pinyin, pos, trans]) => ({ word, pinyin, pos, trans }));
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function cellHtml(entry, level, index) {
  const widthClass = "w" + Math.min(entry.word.length, 4);
  const audio = `audio/${level.audioDir}/${String(index + 1).padStart(4, "0")}.mp3`;
  return (
    `<span class="cell ${widthClass}" tabindex="0" ` +
    `data-word="${escapeHtml(entry.word)}" data-pinyin="${escapeHtml(entry.pinyin)}" ` +
    `data-pos="${escapeHtml(entry.pos)}" data-trans="${escapeHtml(entry.trans)}" ` +
    `data-level="${escapeHtml(level.label)}" data-audio="${audio}">${escapeHtml(entry.word)}</span>`
  );
}

function rgb([r, g, b]) {
  return `rgb(${r},${g},${b})`;
}
function rgba([r, g, b], a) {
  return `rgba(${r},${g},${b},${a})`;
}

function buildColumn(levels, entriesByLevel, targetRows) {
  const blocks = levels.map((level) => {
    const entries = entriesByLevel.get(level);
    const cells = entries.map((e, i) => cellHtml(e, level, i));
    return { level, cells, count: entries.length };
  });

  const cols = levels[0].cols;
  let naturalRows = blocks.reduce((sum, b) => sum + Math.ceil(b.cells.length / cols), 0);
  if (targetRows != null) {
    let idx = blocks.length - 1;
    while (naturalRows < targetRows) {
      blocks[idx].cells.push(...Array(cols).fill('<span class="cell empty"></span>'));
      naturalRows++;
      idx = idx > 0 ? idx - 1 : blocks.length - 1;
    }
  }

  const parts = blocks.map((b, i) => {
    const { level } = b;
    const style =
      `--cols:${level.cols};--tint-light:${rgba(level.hueLight, 0.16)};` +
      `--tint-dark:${rgba(level.hueDark, 0.26)};--hue-light:${rgb(level.hueLight)};--hue-dark:${rgb(level.hueDark)};`;
    const opener = i === 0 ? '<div class="col"><div class="block"' : '</div><div class="block"';
    return (
      `${opener} style="${style}">` +
      `<span class="tag">${escapeHtml(level.label)} &middot; ${b.count}</span>` +
      `<div class="grid">${b.cells.join("")}</div>`
    );
  });
  parts.push("</div></div>");
  return { html: parts.join("\n"), rows: naturalRows };
}

async function main() {
  const entriesByLevel = new Map(await Promise.all(LEVELS.map(async (level) => [level, await loadLevel(level)])).then((pairs) => pairs));

  const col1Levels = LEVELS.filter((l) => l.column === 1);
  const col2Levels = LEVELS.filter((l) => l.column === 2);

  const col1Natural = buildColumn(col1Levels, entriesByLevel, null).rows;
  const col2Natural = buildColumn(col2Levels, entriesByLevel, null).rows;
  const targetRows = Math.max(col1Natural, col2Natural);

  const col1 = buildColumn(col1Levels, entriesByLevel, targetRows);
  const col2 = buildColumn(col2Levels, entriesByLevel, targetRows);

  document.querySelector(".poster").innerHTML = col1.html + "\n" + col2.html;

  const legend = LEVELS.map((level) => {
    const style = `--hue-light:${rgb(level.hueLight)};--hue-dark:${rgb(level.hueDark)}`;
    return `<span class="legend-item"><i style="${style}"></i>${escapeHtml(level.label)} &middot; ${entriesByLevel.get(level).length}</span>`;
  }).join("");
  document.querySelector(".legend").innerHTML = legend;

  document.querySelector(".subtitle").textContent =
    `Click a cell to zoom in like a flashcard (click outside or press Esc to close). ` +
    `Column 1 (H1–H5): ${col1Levels[0].cols} cols × ${targetRows} rows, ` +
    `column 2 (H6, HSK 7–9): ${col2Levels[0].cols} cols × ${targetRows} rows.`;

  initFlashcard();
  initSearch();
}

function initFlashcard() {
  const overlay = document.getElementById("card-overlay");
  const card = overlay.querySelector(".card");
  const wordEl = overlay.querySelector(".card-word");
  const pinyinEl = overlay.querySelector(".card-pinyin");
  const posEl = overlay.querySelector(".card-pos");
  const transEl = overlay.querySelector(".card-trans");
  const levelEl = overlay.querySelector(".card-level");
  const speakBtn = document.getElementById("speak-btn");
  let currentWord = "";
  let currentAudioPath = "";

  // Pre-recorded audio (audio/<level>/<index>.mp3) is the primary source;
  // the Web Speech API is only a fallback for browsers/devices where a
  // file is missing or fails to load.
  const synth = window.speechSynthesis || null;
  let zhVoice = null;
  function pickVoice() {
    if (!synth) return;
    const voices = synth.getVoices();
    zhVoice = voices.find((v) => v.lang === "zh-CN") || voices.find((v) => v.lang && v.lang.indexOf("zh") === 0) || null;
  }
  if (synth) {
    pickVoice();
    synth.addEventListener("voiceschanged", pickVoice);
  }

  function speakFallback(text) {
    if (!synth || !text) return;
    synth.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "zh-CN";
    if (zhVoice) utter.voice = zhVoice;
    utter.rate = 0.9;
    utter.onstart = () => speakBtn.classList.add("speaking");
    utter.onend = () => speakBtn.classList.remove("speaking");
    utter.onerror = () => speakBtn.classList.remove("speaking");
    synth.speak(utter);
  }

  const audioEl = new Audio();
  audioEl.preload = "none";
  audioEl.addEventListener("playing", () => speakBtn.classList.add("speaking"));
  audioEl.addEventListener("ended", () => speakBtn.classList.remove("speaking"));
  audioEl.addEventListener("pause", () => speakBtn.classList.remove("speaking"));
  audioEl.addEventListener("error", () => speakFallback(currentWord));

  function playPronunciation() {
    if (!currentAudioPath) {
      speakFallback(currentWord);
      return;
    }
    audioEl.pause();
    audioEl.currentTime = 0;
    audioEl.src = currentAudioPath;
    const playPromise = audioEl.play();
    if (playPromise && playPromise.catch) {
      playPromise.catch(() => speakFallback(currentWord));
    }
  }

  function openCard(cell) {
    const hue = getComputedStyle(cell).getPropertyValue("--hue-light");
    card.style.setProperty("--hue-light", hue.trim() || "#333");
    currentWord = cell.dataset.word || "";
    currentAudioPath = cell.dataset.audio || "";
    wordEl.textContent = currentWord;
    pinyinEl.textContent = cell.dataset.pinyin || "";
    posEl.textContent = cell.dataset.pos || "";
    posEl.style.display = cell.dataset.pos ? "inline-block" : "none";
    transEl.textContent = cell.dataset.trans || "";
    levelEl.textContent = cell.dataset.level || "";
    overlay.classList.add("open");
  }
  function closeCard() {
    overlay.classList.remove("open");
    audioEl.pause();
    if (synth) synth.cancel();
  }
  speakBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    playPronunciation();
  });
  document.querySelector(".poster").addEventListener("click", (e) => {
    const cell = e.target.closest(".cell:not(.empty)");
    if (cell) openCard(cell);
  });
  document.querySelector(".poster").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      const cell = e.target.closest(".cell:not(.empty)");
      if (cell) {
        e.preventDefault();
        openCard(cell);
      }
    }
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeCard();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeCard();
  });
}

function initSearch() {
  document.getElementById("vocabSearch").addEventListener("input", function () {
    const query = this.value.toLowerCase().trim();

    // Hàm loại bỏ dấu pinyin để gõ pinyin không dấu vẫn tìm được
    const normalizePinyin = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const normalizedQuery = normalizePinyin(query);

    document.querySelectorAll(".cell").forEach((cell) => {
      if (cell.classList.contains("empty")) return;

      const word = (cell.getAttribute("data-word") || "").toLowerCase();
      const pinyin = (cell.getAttribute("data-pinyin") || "").toLowerCase();
      const trans = (cell.getAttribute("data-trans") || "").toLowerCase();

      const isMatch = word.includes(query) || pinyin.includes(query) || normalizePinyin(pinyin).includes(normalizedQuery) || trans.includes(query);

      cell.classList.toggle("not-matched", query !== "" && !isMatch);
    });
  });
}

main().catch((err) => {
  document.querySelector(".poster").textContent = "Failed to load vocabulary data: " + err.message;
  console.error(err);
});
