const STORAGE_KEY = "warehouse-items-v1";
const DEPARTMENT_CATEGORIES = {
  Swiatlo: ["Lampy", "Reflektory", "Sterowanie", "Okablowanie"],
  Dzwiek: ["Miksery", "Mikrofony", "Kolumny", "Procesory"],
  Scena: ["Podesty", "Kurtyny", "Elementy sceny", "Bezpieczenstwo"],
  Kraty: ["Kraty glowne", "Laczniki", "Mocowania", "Akcesoria"],
};

const form = document.getElementById("item-form");
const searchInput = document.getElementById("search");
const itemsBody = document.getElementById("items-body");
const rowTemplate = document.getElementById("row-template");
const statsContainer = document.getElementById("stats");
const csvFileInput = document.getElementById("csv-file");
const prepareImportButton = document.getElementById("prepare-import");
const runImportButton = document.getElementById("run-import");
const csvMeta = document.getElementById("csv-meta");
const csvMapping = document.getElementById("csv-mapping");
const csvResult = document.getElementById("csv-result");
const buildVersion = document.getElementById("build-version");

const TARGET_FIELDS = [
  { key: "department", label: "Dział" },
  { key: "category", label: "Kategoria" },
  { key: "name", label: "Nazwa" },
  { key: "weight", label: "Waga (kg)" },
  { key: "quantity", label: "Ilość" },
  { key: "deviceCode", label: "Kod urządzenia" },
];

const fields = {
  department: document.getElementById("department"),
  category: document.getElementById("category"),
  name: document.getElementById("name"),
  weight: document.getElementById("weight"),
  quantity: document.getElementById("quantity"),
  deviceCode: document.getElementById("deviceCode"),
};

let items = loadItems();
let editingCode = null;
let importRows = [];
let importHeaders = [];

function loadItems() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return parsed.map((item) => {
      if (item.deviceCode && item.department && item.category) {
        return item;
      }
      return {
        department: "Swiatlo",
        category: "Inne",
        name: item.name || "",
        weight: Number(item.weight ?? 0),
        quantity: Number(item.quantity ?? 0),
        deviceCode: item.deviceCode || item.sku || "",
      };
    });
  } catch {
    return [];
  }
}

function saveItems() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function normalizeText(value) {
  return String(value).trim().toLowerCase();
}

function normalizeDepartment(value) {
  const normalized = normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, "");

  if (normalized.includes("swiat")) return "Swiatlo";
  if (normalized.includes("dzwiek") || normalized.includes("dzwiek")) return "Dzwiek";
  if (normalized.includes("scena")) return "Scena";
  if (normalized.includes("kraty") || normalized.includes("kraty")) return "Kraty";
  return value;
}

function parseNumber(value) {
  const normalized = String(value).trim().replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "nieznana data";
  }
  return date.toLocaleString("pl-PL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function loadBuildVersion() {
  if (!buildVersion) return;

  try {
    const response = await fetch(`build-info.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Brak metadanych");
    }

    const info = await response.json();
    const shortCommit = String(info.commit || "").slice(0, 7) || "lokalna";
    const deployedAt = formatDateTime(info.deployedAt);
    buildVersion.textContent = `Wersja: ${shortCommit} • ${deployedAt}`;
  } catch {
    buildVersion.textContent = "Wersja: lokalna";
  }
}

function detectDelimiter(headerLine) {
  const delimiters = [",", ";", "\t"];
  const scores = delimiters.map((delimiter) => ({
    delimiter,
    score: headerLine.split(delimiter).length,
  }));
  scores.sort((a, b) => b.score - a.score);
  return scores[0].score > 1 ? scores[0].delimiter : ",";
}

function parseCsv(text, delimiter) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      row.push(current.trim());
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      row.push(current.trim());
      current = "";
      if (row.some((cell) => cell !== "")) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    current += char;
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current.trim());
    if (row.some((cell) => cell !== "")) {
      rows.push(row);
    }
  }

  return rows;
}

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Nie udało się odczytać pliku CSV."));
    reader.readAsText(file, "utf-8");
  });
}

function upsertItem(newItem) {
  const existingIndex = items.findIndex((item) => item.deviceCode === newItem.deviceCode);
  if (existingIndex >= 0) {
    items[existingIndex] = newItem;
  } else {
    items.push(newItem);
  }
}

function renderCategoryOptions(selectedDepartment, selectedCategory = "") {
  const categories = [...(DEPARTMENT_CATEGORIES[selectedDepartment] || [])];
  if (selectedCategory && !categories.includes(selectedCategory)) {
    categories.push(selectedCategory);
  }
  fields.category.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = categories.length ? "Wybierz kategorię" : "Brak kategorii";
  fields.category.appendChild(placeholder);

  for (const category of categories) {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    if (category === selectedCategory) {
      option.selected = true;
    }
    fields.category.appendChild(option);
  }
}

function renderMappingSelectors(headers) {
  csvMapping.innerHTML = "";

  for (const target of TARGET_FIELDS) {
    const wrapper = document.createElement("div");
    wrapper.className = "mapping-field";

    const label = document.createElement("label");
    label.textContent = target.label;
    label.setAttribute("for", `map-${target.key}`);

    const select = document.createElement("select");
    select.id = `map-${target.key}`;
    select.dataset.targetField = target.key;

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Wybierz nagłówek z CSV";
    select.appendChild(placeholder);

    for (const header of headers) {
      const option = document.createElement("option");
      option.value = header;
      option.textContent = header;
      select.appendChild(option);
    }

    wrapper.appendChild(label);
    wrapper.appendChild(select);
    csvMapping.appendChild(wrapper);
  }
}

function getMapping() {
  const mapping = {};
  for (const target of TARGET_FIELDS) {
    const select = document.getElementById(`map-${target.key}`);
    if (!select || !select.value) {
      throw new Error(`Brak mapowania dla pola: ${target.label}`);
    }
    mapping[target.key] = select.value;
  }
  return mapping;
}

function buildItemFromCsv(rowMap, rowNumber) {
  const department = normalizeDepartment(rowMap.department);
  const category = String(rowMap.category || "").trim();
  const name = String(rowMap.name || "").trim();
  const deviceCode = String(rowMap.deviceCode || "").trim();
  const weight = parseNumber(rowMap.weight);
  const quantity = parseNumber(rowMap.quantity);

  if (!DEPARTMENT_CATEGORIES[department]) {
    throw new Error(`Wiersz ${rowNumber}: niepoprawny dział (${rowMap.department})`);
  }
  if (!category) {
    throw new Error(`Wiersz ${rowNumber}: pusta kategoria`);
  }
  if (!name) {
    throw new Error(`Wiersz ${rowNumber}: pusta nazwa`);
  }
  if (!deviceCode) {
    throw new Error(`Wiersz ${rowNumber}: pusty kod urządzenia`);
  }
  if (Number.isNaN(weight) || weight < 0) {
    throw new Error(`Wiersz ${rowNumber}: niepoprawna waga`);
  }
  if (Number.isNaN(quantity) || quantity < 0) {
    throw new Error(`Wiersz ${rowNumber}: niepoprawna ilość`);
  }

  return {
    department,
    category,
    name,
    weight,
    quantity,
    deviceCode,
  };
}

function resetForm() {
  form.reset();
  editingCode = null;
  fields.deviceCode.disabled = false;
  renderCategoryOptions(fields.department.value);
}

function fillForm(item) {
  fields.department.value = item.department;
  renderCategoryOptions(item.department, item.category);
  fields.name.value = item.name;
  fields.weight.value = item.weight;
  fields.quantity.value = item.quantity;
  fields.deviceCode.value = item.deviceCode;
  editingCode = item.deviceCode;
  fields.deviceCode.disabled = true;
}

function renderStats(current) {
  const totalQuantity = current.reduce((sum, item) => sum + item.quantity, 0);
  const totalWeight = current.reduce((sum, item) => sum + item.weight * item.quantity, 0);

  statsContainer.innerHTML = [
    ["Pozycje", current.length],
    ["Sztuk łącznie", totalQuantity],
    ["Łączna masa (kg)", totalWeight.toFixed(2)],
  ]
    .map(
      ([label, value]) =>
        `<div class="stat"><span>${label}</span><strong>${value}</strong></div>`
    )
    .join("");
}

function renderRows() {
  const query = normalizeText(searchInput.value);
  const filtered = items
    .filter((item) => {
      const haystack = [item.department, item.category, item.name, item.deviceCode]
        .map(normalizeText)
        .join(" ");
      return haystack.includes(query);
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pl"));

  itemsBody.innerHTML = "";

  for (const item of filtered) {
    const row = rowTemplate.content.cloneNode(true);
    row.querySelector('[data-field="department"]').textContent = item.department;
    row.querySelector('[data-field="category"]').textContent = item.category;
    row.querySelector('[data-field="name"]').textContent = item.name;
    row.querySelector('[data-field="weight"]').textContent = item.weight.toFixed(2);
    row.querySelector('[data-field="quantity"]').textContent = item.quantity;
    row.querySelector('[data-field="deviceCode"]').textContent = item.deviceCode;

    row.querySelector('[data-action="edit"]').addEventListener("click", () => {
      fillForm(item);
      fields.name.focus();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    row.querySelector('[data-action="delete"]').addEventListener("click", () => {
      if (!confirm(`Usunąć ${item.name}?`)) return;
      items = items.filter((entry) => entry.deviceCode !== item.deviceCode);
      saveItems();
      renderRows();
    });

    itemsBody.appendChild(row);
  }

  renderStats(filtered);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const payload = {
    department: fields.department.value,
    category: fields.category.value,
    name: fields.name.value.trim(),
    weight: Number(fields.weight.value),
    quantity: Number(fields.quantity.value),
    deviceCode: fields.deviceCode.value.trim(),
  };

  if (
    !payload.department ||
    !payload.category ||
    !payload.name ||
    !payload.deviceCode ||
    Number.isNaN(payload.weight) ||
    Number.isNaN(payload.quantity)
  ) {
    alert("Uzupełnij poprawnie formularz.");
    return;
  }

  if (payload.weight < 0 || payload.quantity < 0) {
    alert("Waga i ilość nie mogą być ujemne.");
    return;
  }

  if (editingCode && editingCode !== payload.deviceCode) {
    payload.deviceCode = editingCode;
  }

  upsertItem(payload);
  saveItems();
  renderRows();
  resetForm();
});

searchInput.addEventListener("input", renderRows);
fields.department.addEventListener("change", () => {
  renderCategoryOptions(fields.department.value);
});

prepareImportButton.addEventListener("click", async () => {
  const file = csvFileInput.files?.[0];
  csvResult.textContent = "";
  csvResult.className = "csv-result";

  if (!file) {
    csvResult.textContent = "Wybierz plik CSV przed przygotowaniem mapowania.";
    csvResult.classList.add("error");
    return;
  }

  try {
    const text = await readFileText(file);
    const firstLine = text.split(/\r?\n/)[0] || "";
    const delimiter = detectDelimiter(firstLine);
    const parsedRows = parseCsv(text, delimiter);

    if (parsedRows.length < 2) {
      throw new Error("CSV musi zawierać nagłówki i co najmniej 1 wiersz danych.");
    }

    importHeaders = parsedRows[0].map((header) => header.trim());
    importRows = parsedRows.slice(1);

    renderMappingSelectors(importHeaders);
    runImportButton.disabled = false;
    csvMeta.textContent = `Wczytano ${importRows.length} wierszy. Wykryty separator: ${delimiter === "\t" ? "TAB" : delimiter}`;
  } catch (error) {
    runImportButton.disabled = true;
    csvMapping.innerHTML = "";
    csvMeta.textContent = "";
    csvResult.textContent = error.message;
    csvResult.classList.add("error");
  }
});

runImportButton.addEventListener("click", () => {
  csvResult.textContent = "";
  csvResult.className = "csv-result";

  try {
    const mapping = getMapping();
    const imported = [];

    for (let index = 0; index < importRows.length; index += 1) {
      const row = importRows[index];
      const rowObject = {};
      for (let headerIndex = 0; headerIndex < importHeaders.length; headerIndex += 1) {
        rowObject[importHeaders[headerIndex]] = row[headerIndex] ?? "";
      }

      const mappedRow = {};
      for (const target of TARGET_FIELDS) {
        mappedRow[target.key] = rowObject[mapping[target.key]];
      }

      imported.push(buildItemFromCsv(mappedRow, index + 2));
    }

    for (const item of imported) {
      upsertItem(item);
    }

    saveItems();
    renderRows();
    csvResult.textContent = `Zaimportowano ${imported.length} pozycji.`;
    csvResult.classList.add("success");
  } catch (error) {
    csvResult.textContent = error.message;
    csvResult.classList.add("error");
  }
});

renderCategoryOptions(fields.department.value);
renderRows();
loadBuildVersion();
