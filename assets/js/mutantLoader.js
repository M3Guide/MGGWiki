const convertGene = {
  "Cyber": "a", "Necro": "b", "Saber": "c",
  "Zoomorph": "d", "Galactic": "e", "Mythic": "f", "Neutral": ""
};
const geneIcons = {
  "Cyber": "a",
  "Necro": "b",
  "Saber": "c",
  "Zoomorph": "d",
  "Galactic": "e",
  "Mythic": "f",
  "Neutral": "all"
};
const stars = { 0: "", 1: "bronze", 2: "silver", 3: "gold", 4: "platinum" };
var mutantData;
var mutantBingo;
var mutantBingoGrids = {};
var upgraded = false;
const GENE_MAP = {
  "Cyber":     { url: "/genes/cyber/",     icon: "../../images/genes/gene_a.png" },
  "Necro":     { url: "/genes/necro/",     icon: "../../images/genes/gene_b.png" },
  "Saber":     { url: "/genes/saber/",     icon: "../../images/genes/gene_c.png" },
  "Zoomorph":  { url: "/genes/zoomorph/",  icon: "../../images/genes/gene_d.png" },
  "Galactic":  { url: "/genes/galactic/",  icon: "../../images/genes/gene_e.png" },
  "Mythic":    { url: "/genes/mythic/",    icon: "../../images/genes/gene_f.png" },
  "Neutral":   { url: "/genes/neutral/",   icon: "../../images/genes/gene_all.png" }
};

const CATEGORY_MAP = {
  "Common":     { url: "/category/common/",     icon: "../../images/category/Common.png" },
  "Legendary":  { url: "/category/legendary/",  icon: "../../images/category/Legendary.png" },
  "Exclusive":  { url: "/category/exclusive/",  icon: "../../images/category/Exclusive.png" },
  "PvP":        { url: "/category/pvp/",        icon: "../../images/category/PvP.png" },
  "Reactor":    { url: "/category/reactor/",    icon: "../../images/category/Reactor.png" },
  "Secret":     { url: "/category/secret/",     icon: "../../images/category/Secret.png" },
  "Heroic":     { url: "/category/heroic/",     icon: "../../images/category/Heroic.png" },
  "Seasonal":   { url: "/category/seasonal/",   icon: "../../images/category/Seasonal.png" },
  "Zodiac":     { url: "/category/zodiac/",     icon: "../../images/category/Zodiac.png" },
  "Video Game": { url: "/category/video-game/", icon: "../../images/category/Video_Game.png" }
};

const ABILITY_MAP = {
  "Shield":   { url: "/ability/shield/",    icon: "../../images/ability/Shield.png" },
  "Drain":    { url: "/ability/drain/",     icon: "../../images/ability/Drain.png" },
  "Retaliate":{ url: "/ability/retaliate/", icon: "../../images/ability/Retaliate.png" },
  "Wound":    { url: "/ability/wound/",     icon: "../../images/ability/Wound.png" },
  "Boost":    { url: "/ability/boost/",     icon: "../../images/ability/Boost.png" },
  "Curse":    { url: "/ability/curse/",     icon: "../../images/ability/Curse.png" }
};

const SUPPLIES_MAP = {
  "Reactor":          { url: "/supplies/reactortoken/",    icon: "../../images/supplies/rt.png" },
  "Credits":          { url: "/supplies/credits/",    icon: "../../images/supplies/credits.png" },
  "Gold":             { url: "/supplies/gold/",    icon: "../../images/supplies/gold.png" },
  "Bronze version":   { url: "/supplies/bronzestar/",    icon: "../../images/supplies/bronzestar.png" },
  "Silver version":   { url: "/supplies/silverstar/",    icon: "../../images/supplies/silverstar.png" },
  "Gold version":     { url: "/supplies/goldstar/",    icon: "../../images/supplies/goldstar.png" },
  "Platinum version": { url: "/supplies/platinumstar/",    icon: "../../images/supplies/platinumstar.png" }
};
function makeLink(label, url, icon, iconClass) {
  const img = icon
    ? `<img src="${icon}" alt="" class="${iconClass}" aria-hidden="true">`
    : "";
  return `<a href="${url}" class="rich-link">${img}${label}</a>`;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function richText(text, allMutants) {
  if (!text) return "";
  const safe = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const terms = [];
  Object.entries(GENE_MAP).forEach(([name, cfg]) => {
    terms.push({ term: name, url: cfg.url, icon: cfg.icon, iconClass: "rich-icon rich-icon--gene" });
  });
  Object.entries(CATEGORY_MAP).forEach(([name, cfg]) => {
    terms.push({ term: name, url: cfg.url, icon: cfg.icon, iconClass: "rich-icon rich-icon--category" });
  });

  Object.entries(ABILITY_MAP).forEach(([name, cfg]) => {
    terms.push({ term: name, url: cfg.url, icon: cfg.icon, iconClass: "rich-icon rich-icon--ability" });
  });

  Object.entries(SUPPLIES_MAP).forEach(([name, cfg]) => {
    terms.push({ term: name, url: cfg.url, icon: cfg.icon, iconClass: "rich-icon--supplies" });
  });
  // Mutant names from CSV — no icon, just a link
  if (allMutants && allMutants.length) {
    allMutants.forEach(row => {
      const name = (row["Name"] || "").trim();
      if (name) {
        const slug = name.toLowerCase().replace(/\s+/g, "-");
        terms.push({ term: name, url: `/mutants/${slug}/`, icon: null, iconClass: "" });
      }
    });
  }

  // Sort longest first to prevent partial-match
  terms.sort((a, b) => b.term.length - a.term.length);

  // Use a placeholder strategy. Replace matches with unique tokens, then swap in HTML
  const placeholders = [];
  let result = safe;

  terms.forEach(({ term, url, icon, iconClass }) => {
    // \b may not work well for multi-word terms; use a lookahead/lookbehind on non-word chars
    const boundary = `(?<![\\w])`;
    const boundaryEnd = `(?![\\w])`;
    const pattern = new RegExp(`${boundary}${escapeRegex(term)}${boundaryEnd}`, "g");

    result = result.replace(pattern, match => {
      const html = makeLink(match, url, icon, iconClass);
      const token = `\x00PLACEHOLDER_${placeholders.length}\x00`;
      placeholders.push(html);
      return token;
    });
  });

  // Restore placeholders
  placeholders.forEach((html, i) => {
    result = result.replace(`\x00PLACEHOLDER_${i}\x00`, html);
  });

  return result;
}
function parseCSV(csvText) {
  const rows = [];
  let currentRow = [];
  let currentField = "";
  let insideQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const next = csvText[i + 1];

    if (char === '"' && insideQuotes && next === '"') {
      currentField += '"';
      i++;
    } else if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === ',' && !insideQuotes) {
      currentRow.push(currentField);
      currentField = "";
    } else if ((char === '\n' || char === '\r') && !insideQuotes) {
      if (currentField.length > 0 || currentRow.length > 0) {
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = "";
      }
    } else {
      currentField += char;
    }
  }
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}
function convertTime(s){
  var ans = "";
  var m = [1440,60,1];
  var t = [0,0,0];
  var n = ['day','hr','mins'];
  for(var i = 0; i < 3; i++){
    t[i] = parseInt(s/m[i]);
    s = s % m[i];
    if(t[i]){
      ans += t[i] + n[i] + ' ';
    }
  }
  return ans;
}

function isSpread(atkSlot, upgraded, atkTypeMinus, atkTypePlus){
  var atkType = upgraded ? atkTypePlus : atkTypeMinus;
  if (atkSlot === 0 && atkType % 2 === 1){
    return true;
  }
  if (atkSlot === 1 && atkType > 1){
    return true;
  }
  return false;
}
function applyArrows(){
  const skinSelectorDiv = document.getElementById("mutant-skin-selector");
  const leftArrow = document.getElementById("skin-left");
  const rightArrow = document.getElementById("skin-right");

  function updateArrows() {
    const maxScrollLeft = skinSelectorDiv.scrollWidth - skinSelectorDiv.clientWidth;
    const current = skinSelectorDiv.scrollLeft;
    leftArrow.style.display = current > 5 ? "block" : "none";
    rightArrow.style.display = current < maxScrollLeft - 5 ? "block" : "none";
  }

  leftArrow.onclick = () => {
    skinSelectorDiv.scrollBy({ left: -skinSelectorDiv.clientWidth * 0.8, behavior: "smooth" });
  };
  rightArrow.onclick = () => {
    skinSelectorDiv.scrollBy({ left: skinSelectorDiv.clientWidth * 0.8, behavior: "smooth" });
  };
  skinSelectorDiv.addEventListener("scroll", updateArrows);
  updateArrows();
  rightArrow.textContent = "›";
  leftArrow.textContent = "‹";
}

function applyGenes(m, g1, g2){
  const geneNames = [];
  const geneImage = "../../images/genes/gene_";
  if (g1 !== "Neutral" && geneIcons[g1])
    geneNames.push(`<a href="${GENE_MAP[g1].url}" class="gene-icon-link"><img src="${geneImage+geneIcons[g1]}.png" alt="${g1}" class="gene-icon"></a>`);
  if (g2 !== "Neutral" && geneIcons[g2])
    geneNames.push(`<a href="${GENE_MAP[g2].url}" class="gene-icon-link"><img src="${geneImage+geneIcons[g2]}.png" alt="${g2}" class="gene-icon"></a>`);
  document.getElementById("mutant-genes").innerHTML = geneNames.join("") || "Neutral";
  if(m["Atk1 Gene"] != ''){
    g1 = m["Atk1 Gene"];
  }
  if(m["Atk2 Gene"] != ''){
    g2 = m["Atk2 Gene"];
  }
  document.getElementById("stat-gene-1").src = `${geneImage+geneIcons[g1]}.png`;
  document.getElementById("stat-gene-2").src = `${geneImage+geneIcons[g2]}.png`;
  document.getElementById("stat-attack1-box").setAttribute("data-gene", g1);
  document.getElementById("stat-attack2-box").setAttribute("data-gene", g2);
}

function applyIcons(m, g1, g2){
  const linkCode = m["ID"];
  const mutantIcons = `https://raw.githubusercontent.com/M3Guide/MGGImages/refs/heads/main/icons/${m["Gene 1"]}/${linkCode}`;
  const mutantMainLink = `https://raw.githubusercontent.com/CertifiedHabibi/MutantPNGs${g1}/refs/heads/main/mutants_${g1.toLowerCase()}/specimen_${linkCode}`;
  let versions = [""];
  const category = (m["Category"] || "").toLowerCase();
  const categoryImage = "../../images/category/";
  const catKey = m["Category"];
  const catCfg = CATEGORY_MAP[catKey];
  const catUrl = catCfg ? catCfg.url : "#";
  document.getElementById("mutant-category").innerHTML = `<a href="${catUrl}" class="category-icon-link"><img src="${categoryImage}${(category === "video game") ? "Video_Game" : catKey}.png" alt="${catKey}" class="category-icon"></a>`;

  const abilKey = m["Ability"];
  const abilCfg = ABILITY_MAP[abilKey];
  const abilUrl = abilCfg ? abilCfg.url : "#";
  document.getElementById("mutant-ability").innerHTML = `<a href="${abilUrl}" class="ability-icon-link"><img src="../../images/ability/${abilKey}.png" class="category-icon"></a>`;

  if (["common", "legendary", "pvp", "secret", "heroic"].includes(category)) {
    versions.push("bronze", "silver", "gold", "platinum");
  } else if (category === "zodiac") {
    versions.push("silver");
  }

  if (m["Skins"] && m["Skins"].trim() !== "") {
    const extraSkins = m["Skins"].split(/[/;]/).map(s => s.trim()).filter(Boolean);
    versions = versions.concat(extraSkins);
  }

  const preloadedImages = {};
  const preloadedBackgrounds = {};
  versions.forEach(v => {
    const img = new Image();
    img.src = `${mutantMainLink}${v ? `_${v}` : ""}.png`;
    preloadedImages[v] = img;
  });

  const possibleBackgrounds = new Set([(m["Category"] === "Video Game") ? "Video_Game" : m["Category"], "Reactor"]);
  possibleBackgrounds.forEach(bg => {
    const bgImg = new Image();
    bgImg.src = `../../images/category/${bg}_BG.png`;
    preloadedBackgrounds[bg] = bgImg;
  });

  const boxImage = document.getElementById("mutant-image");
  const skinSelector = document.getElementById("mutant-skin-selector");
  if(versions.length === 1){
    document.getElementById("skin-selector-wrapper").style.display = 'none';
  }

  var currBg = m["Category"];
  if(currBg === "Video Game") currBg = "Video_Game";
  var bgImage = document.getElementById("mutant-image-container");
  bgImage.style.backgroundImage = `url(${preloadedBackgrounds[currBg]?.src || "../../images/category/" + currBg + "_BG.png"})`;

  let skinsHTML = "";
  for (let i = 0; i < versions.length; i++) {
    let version = versions[i];
    const underScore = (version === "") ? "" : '_';
    var label = version ? version[0].toUpperCase() + version.slice(1) : "Basic";
    if(versions.length === 1) label = "Default";
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.onclick = () => {
      boxImage.src = preloadedImages[version].src;
      skinSelector.querySelectorAll("button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currBg = m["Category"];
      if(currBg === "Video Game") currBg = "Video_Game";
      var isReactor = ["girl","gothic","steampunk","heroes","japan","starwars",
                       "boss","villains","olympians","movies","elements","soldiers",
                       "lucha","fantasy","music","western","beach","vegetal",
                       "olympics","chess"];
      if(isReactor.includes(version)) currBg = "Reactor";
      bgImage.style.backgroundImage = `url(${preloadedBackgrounds[currBg]?.src || categoryImage + currBg + "_BG.png"})`;
    };
    if (i === 0) {
      btn.classList.add("active");
      boxImage.src = preloadedImages[version].src;
    }
    skinSelector.appendChild(btn);

    var iconImage = mutantIcons + underScore + version;
    skinsHTML += `
      <div class="version">
        <img src="${iconImage}.png" alt="${label}">
        <span class="version-label">${label}</span>
      </div>`;
  }

  document.getElementById("mutant-skins").innerHTML = skinsHTML;
  document.getElementById("mutant-larvae").innerHTML =
    `<img src="https://raw.githubusercontent.com/M3Guide/MGGImages/refs/heads/main/larva/${m["Gene 1"]}/${linkCode}.png" alt="Larvae">`;
}

function applyStats(){
  const m = mutantData;
  document.getElementById("stat-hp").textContent = parseInt(Number(m[`HP`]));
  document.getElementById("stat-speed").textContent = m[`Speed`];
  document.getElementById("stat-attack1-name").textContent = m[`Atk1${upgraded ? '+' : ''} Name`];
  document.getElementById("stat-attack2-name").textContent = m[`Atk2${upgraded ? '+' : ''} Name`];
  document.getElementById("stat-attack1-damage").textContent = parseInt(Number(m[`Atk1${upgraded ? '+' : ''}`]));
  document.getElementById("stat-attack2-damage").textContent = parseInt(Number(m[`Atk2${upgraded ? '+' : ''}`]));
  document.getElementById("stat-ability").textContent = m[`Ability%${upgraded ? '+' : ''}`];
  document.getElementById("stat-ability-img").src = `../../images/ability/${m["Ability"]}.png`;
  document.getElementById("stat-ability-plus").style.display = upgraded ? "block" : "none";
  document.getElementById("stat-credits").textContent = `${(m["Credits"] !== '') ? m["Credits"] : 42}/hr`;
  document.getElementById("stat-incubation").textContent = convertTime(m["Incubation"]);
  var genePlus = document.querySelectorAll('.stat-gene-plus');
  genePlus.forEach(gene => gene.style.display = upgraded ? "block" : "none");
  var geneSpread = document.querySelectorAll('.stat-gene-spread');
  geneSpread[0].style.display = isSpread(0, upgraded, m["Atk Type-"], m["Atk Type"]) ? "block" : "none";
  geneSpread[1].style.display = isSpread(1, upgraded, m["Atk Type-"], m["Atk Type"]) ? "block" : "none";
}

function applyBingo(){
  var mutantName = mutantData["Name"];
  var mutantID = mutantData["ID"];
  var bingo = mutantBingo[mutantID];
  if(!bingo){
    console.log("No Bingo Data found!");
    return;
  }
  for(var i = 0; i < bingo.length; i++){
    var curr = bingo[i];
    Object.entries(curr).forEach(([key, value]) => {
      var bingoGrid = key.split("_");
      var skin = (bingoGrid.length == 2) ? '_'+bingoGrid[1] : "";
      var bingoName = bingoGrid[0];
      var [columnReward,rowReward] = value;
      console.log(`Grid: ${bingoName}, Mutant: ${mutantID + skin}, Row: ${rowReward}, Column: ${columnReward}`);
    });
  }
}

function applyBulletWrap(text, allMutants, bulletClass) {
  if (!text || !text.trim()) return "";
  return text
    .split(/\r?\n/)
    .filter(line => line.trim() !== "")
    .map(line => `<div class="${bulletClass}">${richText(line, allMutants)}</div>`)
    .join("");
}

async function loadCSV(csvUrl) {
  try {
    const response = await fetch(csvUrl);
    const text = await response.text();
    const rows = parseCSV(text.trim());
    return rows;
  } catch (err) {
    alert("Error loading CSV: " + err);
    return [];
  }
}

async function loadMutantData(csvUrl) {
  try {
    const rows = await loadCSV(csvUrl);
    const headers = rows[0].map(h => h.trim());
    const data = rows.slice(1).map(row => {
      return Object.fromEntries(headers.map((h, i) => [h, row[i]]));
    });

    const m = data.find(r => (r["Name"] || "").trim().toLowerCase() === mutantName.trim().toLowerCase());
    if (!m) throw new Error("Mutant not found in CSV.");
    mutantData = m;

    const overviewEl  = document.getElementById("mutant-overview");
    const obtainEl    = document.getElementById("mutant-obtain");
    const referencesEl = document.getElementById("mutant-references");

    if (overviewEl)    overviewEl.innerHTML   = richText(m["Overview"], data);
    if (obtainEl)      obtainEl.innerHTML     = applyBulletWrap(m["How to Obtain"], data, "obtain-bullet");
    if (referencesEl)  referencesEl.innerHTML = applyBulletWrap(m["References"], data, "ref-bullet");
    document.getElementById("mutant-name").textContent     = m["Name"];
    document.getElementById("mutant-name-box").textContent = m["Name"];
    document.getElementById("mutant-breedable").textContent = m["Breedable?"];
    document.getElementById("mutant-bingo").textContent    = m["Bingo"];
    // Biography (preserves line breaks, no rich-text linking)
    document.getElementById("mutant-biography").innerHTML =
      `<div style="white-space: pre-wrap;">${m["Biography"] || ""}</div>`;
    // Infobox fields (icons applied by applyGenes / applyIcons)
    const g1 = (m["Gene 1"] || "").trim();
    const g2 = (m["Gene 2"] || "").trim();
    applyGenes(m, g1, g2);
    applyIcons(m, g1, g2);
    applyStats();
    applyArrows();
  } catch (err) {
    alert("Error loading mutant data: " + err);
  }
}

async function loadMutantBingo(csvUrl) {
  const data = await loadCSV(csvUrl);
  var i = 0;
  var bingo = {};
  while(i < data.length){
    if(data[i][0] == ''){
      i++;
      var bingoGrid = data[i][0];
      mutantBingoGrids[data[i][0]] = data[i][1];
      var [row, column] = data[i][2].split("_").map(Number);
      var columnRewards = data[i+row+1];
      for(var j = 0; j < row; j++){
        i++;
        for(var k = 0; k < column; k++){
          if(data[i][k] === "") continue;
          var baseMutant = data[i][k].split("_");
          var currentMutant = baseMutant[0] + '_' + baseMutant[1];
          var skin = baseMutant.length > 2 ? '_' + baseMutant[2] : "";
          var key = `${bingoGrid}${skin}`;
          var rewards = [columnRewards[k], data[i][column]];
          if(bingo[currentMutant] === undefined){
            bingo[currentMutant] = [{[key]: rewards}];
          } else {
            bingo[currentMutant].push({[key]: rewards});
          }
        }
      }
    }
    i++;
  }
  mutantBingo = bingo;
}
const mutantDataCSV  = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQh2Z4QbBx5VxQgAwXOueCe3TKK9abQQ-XWVyf5tCGKg3pIxnjhJO6buOVhOO8pCuzYmwvr5dppYTgn/pub?output=csv";
const mutantBingoCSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRbbkoFz27LRxBx3VTOdOBbPqHKm6iAbxeuq3XVrm7XDLWDrO9TgPb9BTuobtL_SnDLkQIEbFy9AXMj/pub?output=csv";

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const [_, __] = await Promise.all([
      loadMutantData(mutantDataCSV),
      loadMutantBingo(mutantBingoCSV)
    ]);
    applyBingo();
  } catch (err) {
    console.error("Error loading CSVs:", err);
  }
});

window.addEventListener("load", () => {
  const toggle       = document.getElementById("toggle-upgraded");
  const baseLabel    = document.getElementById("toggle-base-label");
  const upgradedLabel = document.getElementById("toggle-upgraded-label");

  if (toggle) {
    toggle.addEventListener("change", () => {
      upgraded = toggle.checked;
      applyStats();
      baseLabel.classList.toggle("active", !upgraded);
      upgradedLabel.classList.toggle("active", upgraded);
    });
  }
});