const TABLE_NAME = "warehouse_items";

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
const dataMode = document.getElementById("data-mode");
const filterDepartment = document.getElementById("filter-department");
const filterCategory = document.getElementById("filter-category");
const filterProducer = document.getElementById("filter-producer");

const TARGET_FIELDS = [
  { key: "department", label: "Dział" },
  { key: "category", label: "Kategoria" },
  { key: "producer", label: "Producent" },
  { key: "name", label: "Nazwa" },
  { key: "weight", label: "Waga (kg)" },
  { key: "totalQuantity", label: "Całkowity stan" },
  { key: "currentQuantity", label: "Aktualny stan" },
  { key: "deviceCode", label: "Kod urządzenia" },
];

const fields = {
  department: document.getElementById("department"),
  producer: document.getElementById("producer"),
  category: document.getElementById("category"),
  name: document.getElementById("name"),
  weight: document.getElementById("weight"),
  totalQuantity: document.getElementById("totalQuantity"),
  currentQuantity: document.getElementById("currentQuantity"),
  deviceCode: document.getElementById("deviceCode"),
};

const supabaseUrl = window.APP_CONFIG?.supabaseUrl || "";
const supabaseAnonKey = window.APP_CONFIG?.supabaseAnonKey || "";
const supabaseClient = window.supabase?.createClient(supabaseUrl, supabaseAnonKey);

let items = [];
let editingCode = null;
let importRows = [];
let importHeaders = [];
let hasSplitStockColumns = true;

function normalizeText(value) {
  return String(value).trim().toLowerCase();
}

function normalizeDepartment(value) {
  const normalized = normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, "");

  if (normalized.includes("swiat")) return "Swiatlo";
  if (normalized.includes("dzwiek")) return "Dzwiek";
  if (normalized.includes("scena")) return "Scena";
  if (normalized.includes("kraty")) return "Kraty";
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

function ensureSupabaseConfigured() {
  if (!supabaseUrl || !supabaseAnonKey || !supabaseClient) {
    throw new Error("Brak konfiguracji Supabase w config.js");
  }
}

function renderDataMode(status = "Dane: Supabase (cloud)") {
  if (dataMode) {
    dataMode.textContent = status;
  }
}

function toDbRow(item) {
  if (!hasSplitStockColumns) {
    return {
      device_code: item.deviceCode,
      department: item.department,
      producer: item.producer,
      category: item.category,
      name: item.name,
      weight: item.weight,
      quantity: item.currentQuantity,
    };
  }

  return {
    device_code: item.deviceCode,
    department: item.department,
    producer: item.producer,
    category: item.category,
    name: item.name,
    weight: item.weight,
    total_quantity: item.totalQuantity,
    current_quantity: item.currentQuantity,
    quantity: item.currentQuantity,
  };
}

function fromDbRow(row) {
  const totalQuantity = Number(row.total_quantity ?? row.quantity ?? 0);
  const currentQuantity = Number(row.current_quantity ?? row.quantity ?? 0);

  return {
    department: row.department,
    producer: row.producer,
    category: row.category,
    name: row.name,
    weight: Number(row.weight),
    totalQuantity,
    currentQuantity,
    deviceCode: row.device_code,
  };
}

async function detectWarehouseStockColumns() {
  const { error } = await supabaseClient
    .from(TABLE_NAME)
    .select("device_code, total_quantity, current_quantity")
    .limit(1);

  if (!error) {
    hasSplitStockColumns = true;
    return;
  }

  if (error.code === "42703" || /total_quantity|current_quantity/i.test(error.message)) {
    hasSplitStockColumns = false;
    return;
  }

  throw new Error(`Błąd sprawdzania schematu magazynu: ${error.message}`);
}

async function fetchItems() {
  const selectFields = hasSplitStockColumns
    ? "device_code, department, producer, category, name, weight, quantity, total_quantity, current_quantity"
    : "device_code, department, producer, category, name, weight, quantity";

  const { data, error } = await supabaseClient
    .from(TABLE_NAME)
    .select(selectFields)
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Błąd pobierania danych z chmury: ${error.message}`);
  }

  items = (data || []).map(fromDbRow);
}

async function saveOneItem(item) {
  const { error } = await supabaseClient.from(TABLE_NAME).upsert(toDbRow(item), {
    onConflict: "device_code",
  });

  if (error) {
    throw new Error(`Błąd zapisu do chmury: ${error.message}`);
  }
}

async function saveManyItems(newItems) {
  if (!newItems.length) return;

  const { error } = await supabaseClient.from(TABLE_NAME).upsert(newItems.map(toDbRow), {
    onConflict: "device_code",
  });

  if (error) {
    throw new Error(`Błąd importu do chmury: ${error.message}`);
  }
}

async function deleteOneItem(deviceCode) {
  const { error } = await supabaseClient.from(TABLE_NAME).delete().eq("device_code", deviceCode);
  if (error) {
    throw new Error(`Błąd usuwania z chmury: ${error.message}`);
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
    placeholder.textContent =
      target.key === "totalQuantity" || target.key === "currentQuantity"
        ? "Opcjonalnie - uzyj wartosci domyslnej"
        : "Wybierz nagłówek z CSV";
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
    if (!select) {
      throw new Error(`Brak mapowania dla pola: ${target.label}`);
    }
    if (!select.value && target.key !== "totalQuantity" && target.key !== "currentQuantity") {
      throw new Error(`Brak mapowania dla pola: ${target.label}`);
    }
    mapping[target.key] = select.value;
  }
  return mapping;
}

function buildItemFromCsv(rowMap, rowNumber) {
  const department = normalizeDepartment(rowMap.department);
  const producer = String(rowMap.producer || "").trim();
  const category = String(rowMap.category || "").trim();
  const name = String(rowMap.name || "").trim();
  const deviceCode = String(rowMap.deviceCode || "").trim();
  const weight = parseNumber(rowMap.weight);
  const parsedTotalQuantity = parseNumber(rowMap.totalQuantity);
  const parsedCurrentQuantity = parseNumber(rowMap.currentQuantity);
  const totalQuantity = Number.isNaN(parsedTotalQuantity)
    ? parsedCurrentQuantity
    : parsedTotalQuantity;
  const currentQuantity = Number.isNaN(parsedCurrentQuantity)
    ? totalQuantity
    : parsedCurrentQuantity;

  if (!DEPARTMENT_CATEGORIES[department]) {
    throw new Error(`Wiersz ${rowNumber}: niepoprawny dział (${rowMap.department})`);
  }
  if (!category) {
    throw new Error(`Wiersz ${rowNumber}: pusta kategoria`);
  }
  if (!producer) {
    throw new Error(`Wiersz ${rowNumber}: pusty producent`);
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
  if (Number.isNaN(totalQuantity) || totalQuantity < 0) {
    throw new Error(`Wiersz ${rowNumber}: niepoprawny calkowity stan`);
  }
  if (Number.isNaN(currentQuantity) || currentQuantity < 0) {
    throw new Error(`Wiersz ${rowNumber}: niepoprawny aktualny stan`);
  }
  if (currentQuantity > totalQuantity) {
    throw new Error(`Wiersz ${rowNumber}: aktualny stan nie moze byc wiekszy niz calkowity stan`);
  }

  return {
    department,
    producer,
    category,
    name,
    weight,
    totalQuantity,
    currentQuantity,
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
  fields.producer.value = item.producer;
  renderCategoryOptions(item.department, item.category);
  fields.name.value = item.name;
  fields.weight.value = item.weight;
  fields.totalQuantity.value = item.totalQuantity;
  fields.currentQuantity.value = item.currentQuantity;
  fields.deviceCode.value = item.deviceCode;
  editingCode = item.deviceCode;
  fields.deviceCode.disabled = true;
}

function renderStats(current) {
  const totalQuantity = current.reduce((sum, item) => sum + item.totalQuantity, 0);
  const currentQuantity = current.reduce((sum, item) => sum + item.currentQuantity, 0);
  const totalWeight = current.reduce((sum, item) => sum + item.weight * item.totalQuantity, 0);

  statsContainer.innerHTML = [
    ["Pozycje", current.length],
    ["Calkowity stan", totalQuantity],
    ["Aktualny stan", currentQuantity],
    ["Łączna masa (kg)", totalWeight.toFixed(2)],
  ]
    .map(
      ([label, value]) =>
        `<div class="stat"><span>${label}</span><strong>${value}</strong></div>`
    )
    .join("");
}

function renderSelectOptions(select, values, placeholder, selectedValue = "") {
  select.innerHTML = "";

  const placeholderOption = document.createElement("option");
  placeholderOption.value = "";
  placeholderOption.textContent = placeholder;
  select.appendChild(placeholderOption);

  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    if (value === selectedValue) {
      option.selected = true;
    }
    select.appendChild(option);
  }
}

function renderFilterOptions() {
  const selectedDepartment = filterDepartment.value;
  const selectedCategory = filterCategory.value;
  const selectedProducer = filterProducer.value;

  const departments = [...new Set(items.map((item) => item.department))].sort((a, b) =>
    a.localeCompare(b, "pl")
  );
  const categorySource = selectedDepartment
    ? items.filter((item) => item.department === selectedDepartment)
    : items;
  const categories = [...new Set(categorySource.map((item) => item.category))].sort((a, b) =>
    a.localeCompare(b, "pl")
  );
  const producers = [...new Set(items.map((item) => item.producer))].sort((a, b) =>
    a.localeCompare(b, "pl")
  );

  renderSelectOptions(filterDepartment, departments, "Wszystkie działy", selectedDepartment);
  renderSelectOptions(filterCategory, categories, "Wszystkie kategorie", selectedCategory);
  renderSelectOptions(filterProducer, producers, "Wszyscy producenci", selectedProducer);

  if (selectedDepartment && !departments.includes(selectedDepartment)) {
    filterDepartment.value = "";
  }
  if (selectedCategory && !categories.includes(selectedCategory)) {
    filterCategory.value = "";
  }
  if (selectedProducer && !producers.includes(selectedProducer)) {
    filterProducer.value = "";
  }
}

function getFilteredItems() {
  const query = normalizeText(searchInput.value);
  const selectedDepartment = filterDepartment.value;
  const selectedCategory = filterCategory.value;
  const selectedProducer = filterProducer.value;

  return items
    .filter((item) => {
      const haystack = [item.department, item.category, item.producer, item.name, item.deviceCode]
        .map(normalizeText)
        .join(" ");
      const matchesQuery = haystack.includes(query);
      const matchesDepartment = !selectedDepartment || item.department === selectedDepartment;
      const matchesCategory = !selectedCategory || item.category === selectedCategory;
      const matchesProducer = !selectedProducer || item.producer === selectedProducer;
      return matchesQuery && matchesDepartment && matchesCategory && matchesProducer;
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pl"));
}

function renderRows() {
  renderFilterOptions();
  const filtered = getFilteredItems();

  itemsBody.innerHTML = "";

  for (const item of filtered) {
    const row = rowTemplate.content.cloneNode(true);
    row.querySelector('[data-field="department"]').textContent = item.department;
    row.querySelector('[data-field="category"]').textContent = item.category;
    row.querySelector('[data-field="producer"]').textContent = item.producer;
    row.querySelector('[data-field="name"]').textContent = item.name;
    row.querySelector('[data-field="weight"]').textContent = item.weight.toFixed(2);
    row.querySelector('[data-field="totalQuantity"]').textContent = item.totalQuantity;
    row.querySelector('[data-field="currentQuantity"]').textContent = item.currentQuantity;
    row.querySelector('[data-field="deviceCode"]').textContent = item.deviceCode;

    row.querySelector('[data-action="edit"]').addEventListener("click", () => {
      fillForm(item);
      fields.name.focus();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    row.querySelector('[data-action="delete"]').addEventListener("click", async () => {
      if (!confirm(`Usunąć ${item.name}?`)) return;

      try {
        await deleteOneItem(item.deviceCode);
        await fetchItems();
        renderRows();
      } catch (error) {
        alert(error.message);
      }
    });

    itemsBody.appendChild(row);
  }

  renderStats(filtered);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const payload = {
    department: fields.department.value,
    producer: fields.producer.value.trim(),
    category: fields.category.value,
    name: fields.name.value.trim(),
    weight: Number(fields.weight.value),
    totalQuantity: Number(fields.totalQuantity.value),
    currentQuantity: Number(fields.currentQuantity.value),
    deviceCode: fields.deviceCode.value.trim(),
  };

  if (
    !payload.department ||
    !payload.producer ||
    !payload.category ||
    !payload.name ||
    !payload.deviceCode ||
    Number.isNaN(payload.weight) ||
    Number.isNaN(payload.totalQuantity) ||
    Number.isNaN(payload.currentQuantity)
  ) {
    alert("Uzupełnij poprawnie formularz.");
    return;
  }

  if (payload.weight < 0 || payload.totalQuantity < 0 || payload.currentQuantity < 0) {
    alert("Waga i stany nie moga byc ujemne.");
    return;
  }

  if (payload.currentQuantity > payload.totalQuantity) {
    alert("Aktualny stan nie moze byc wiekszy niz calkowity stan.");
    return;
  }

  if (!hasSplitStockColumns && payload.totalQuantity !== payload.currentQuantity) {
    alert("Baza nie ma jeszcze kolumn calkowity/aktualny stan. Najpierw uruchom migracje Supabase.");
    return;
  }

  if (editingCode && editingCode !== payload.deviceCode) {
    payload.deviceCode = editingCode;
  }

  try {
    await saveOneItem(payload);
    await fetchItems();
    renderRows();
    resetForm();
  } catch (error) {
    alert(error.message);
  }
});

searchInput.addEventListener("input", renderRows);
fields.department.addEventListener("change", () => {
  renderCategoryOptions(fields.department.value);
});
filterDepartment.addEventListener("change", () => {
  renderFilterOptions();
  renderRows();
});
filterCategory.addEventListener("change", renderRows);
filterProducer.addEventListener("change", renderRows);

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

runImportButton.addEventListener("click", async () => {
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

    if (!hasSplitStockColumns && imported.some((item) => item.totalQuantity !== item.currentQuantity)) {
      throw new Error("Baza nie ma jeszcze kolumn calkowity/aktualny stan. Uruchom migracje z supabase.sql przed importem roznych wartosci.");
    }

    await saveManyItems(imported);
    await fetchItems();
    renderRows();
    csvResult.textContent = `Zaimportowano ${imported.length} pozycji.`;
    csvResult.classList.add("success");
  } catch (error) {
    csvResult.textContent = error.message;
    csvResult.classList.add("error");
  }
});

async function init() {
  renderCategoryOptions(fields.department.value);
  loadBuildVersion();

  try {
    ensureSupabaseConfigured();
    await detectWarehouseStockColumns();
    renderDataMode(
      hasSplitStockColumns
        ? "Dane: Supabase (cloud)"
        : "Dane: Supabase (cloud, bez kolumn total/current)"
    );
    await fetchItems();
    renderRows();
  } catch (error) {
    renderDataMode("Dane: błąd konfiguracji Supabase");
    alert(error.message);
  }
}

init();
