const TABLE_NAME = "warehouse_items";

const itemsBody = document.getElementById("items-body");
const rowTemplate = document.getElementById("row-template");
const statsContainer = document.getElementById("stats");
const searchInput = document.getElementById("search");
const buildVersion = document.getElementById("build-version");
const dataMode = document.getElementById("data-mode");
const filterDepartment = document.getElementById("filter-department");
const filterCategory = document.getElementById("filter-category");
const filterProducer = document.getElementById("filter-producer");

const supabaseUrl = window.APP_CONFIG?.supabaseUrl || "";
const supabaseAnonKey = window.APP_CONFIG?.supabaseAnonKey || "";
const supabaseClient = window.supabase?.createClient(supabaseUrl, supabaseAnonKey);

let items = [];

function normalizeText(value) {
  return String(value).trim().toLowerCase();
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "nieznana data";
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
    if (!response.ok) throw new Error("Brak metadanych");
    const info = await response.json();
    const shortCommit = String(info.commit || "").slice(0, 7) || "lokalna";
    buildVersion.textContent = `Wersja: ${shortCommit} • ${formatDateTime(info.deployedAt)}`;
  } catch {
    buildVersion.textContent = "Wersja: lokalna";
  }
}

function renderDataMode(status = "Dane: Supabase (cloud)") {
  if (dataMode) dataMode.textContent = status;
}

function ensureSupabaseConfigured() {
  if (!supabaseUrl || !supabaseAnonKey || !supabaseClient) {
    throw new Error("Brak konfiguracji Supabase w config.js");
  }
}

function fromDbRow(row) {
  return {
    department: row.department,
    producer: row.producer,
    category: row.category,
    name: row.name,
    weight: Number(row.weight),
    quantity: Number(row.quantity),
    deviceCode: row.device_code,
  };
}

async function fetchItems() {
  const { data, error } = await supabaseClient
    .from(TABLE_NAME)
    .select("device_code, department, producer, category, name, weight, quantity")
    .order("name", { ascending: true });

  if (error) throw new Error(`Błąd pobierania danych z chmury: ${error.message}`);
  items = (data || []).map(fromDbRow);
}

function renderStats(current) {
  const totalQuantity = current.reduce((sum, item) => sum + item.quantity, 0);
  const totalWeight = current.reduce((sum, item) => sum + item.weight * item.quantity, 0);

  statsContainer.innerHTML = [
    ["Pozycje", current.length],
    ["Sztuk łącznie", totalQuantity],
    ["Łączna masa (kg)", totalWeight.toFixed(2)],
  ]
    .map(([label, value]) => `<div class="stat"><span>${label}</span><strong>${value}</strong></div>`)
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
    if (value === selectedValue) option.selected = true;
    select.appendChild(option);
  }
}

function renderFilterOptions() {
  const selectedDepartment = filterDepartment.value;
  const selectedCategory = filterCategory.value;
  const selectedProducer = filterProducer.value;

  const departments = [...new Set(items.map((item) => item.department))].sort((a, b) => a.localeCompare(b, "pl"));
  const categorySource = selectedDepartment ? items.filter((item) => item.department === selectedDepartment) : items;
  const categories = [...new Set(categorySource.map((item) => item.category))].sort((a, b) => a.localeCompare(b, "pl"));
  const producerSource = selectedDepartment ? items.filter((item) => item.department === selectedDepartment) : items;
  const producers = [...new Set(producerSource.map((item) => item.producer))].sort((a, b) => a.localeCompare(b, "pl"));

  renderSelectOptions(filterDepartment, departments, "Wszystkie działy", selectedDepartment);
  renderSelectOptions(filterCategory, categories, "Wszystkie kategorie", selectedCategory);
  renderSelectOptions(filterProducer, producers, "Wszyscy producenci", selectedProducer);

  if (selectedCategory && !categories.includes(selectedCategory)) filterCategory.value = "";
  if (selectedProducer && !producers.includes(selectedProducer)) filterProducer.value = "";
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
      return haystack.includes(query)
        && (!selectedDepartment || item.department === selectedDepartment)
        && (!selectedCategory || item.category === selectedCategory)
        && (!selectedProducer || item.producer === selectedProducer);
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
    row.querySelector('[data-field="quantity"]').textContent = item.quantity;
    row.querySelector('[data-field="deviceCode"]').textContent = item.deviceCode;
    itemsBody.appendChild(row);
  }

  renderStats(filtered);
}

searchInput.addEventListener("input", renderRows);
filterDepartment.addEventListener("change", renderRows);
filterCategory.addEventListener("change", renderRows);
filterProducer.addEventListener("change", renderRows);

async function init() {
  loadBuildVersion();
  try {
    ensureSupabaseConfigured();
    renderDataMode();
    await fetchItems();
    renderRows();
  } catch (error) {
    renderDataMode("Dane: błąd konfiguracji Supabase");
    alert(error.message);
  }
}

init();
