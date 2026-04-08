const STORAGE_KEY = "warehouse-items-v1";

const form = document.getElementById("item-form");
const searchInput = document.getElementById("search");
const itemsBody = document.getElementById("items-body");
const rowTemplate = document.getElementById("row-template");
const statsContainer = document.getElementById("stats");

const fields = {
  name: document.getElementById("name"),
  sku: document.getElementById("sku"),
  quantity: document.getElementById("quantity"),
  location: document.getElementById("location"),
  minStock: document.getElementById("minStock"),
};

let items = loadItems();
let editingSku = null;

function loadItems() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
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

function getStatus(item) {
  return item.quantity <= item.minStock ? "Niski" : "OK";
}

function upsertItem(newItem) {
  const existingIndex = items.findIndex((item) => item.sku === newItem.sku);
  if (existingIndex >= 0) {
    items[existingIndex] = newItem;
  } else {
    items.push(newItem);
  }
}

function resetForm() {
  form.reset();
  editingSku = null;
  fields.sku.disabled = false;
}

function fillForm(item) {
  fields.name.value = item.name;
  fields.sku.value = item.sku;
  fields.quantity.value = item.quantity;
  fields.location.value = item.location;
  fields.minStock.value = item.minStock;
  editingSku = item.sku;
  fields.sku.disabled = true;
}

function renderStats(current) {
  const lowCount = current.filter((item) => item.quantity <= item.minStock).length;
  const totalQuantity = current.reduce((sum, item) => sum + item.quantity, 0);

  statsContainer.innerHTML = [
    ["Produkty", current.length],
    ["Sztuk łącznie", totalQuantity],
    ["Niski stan", lowCount],
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
      const haystack = [item.name, item.sku, item.location].map(normalizeText).join(" ");
      return haystack.includes(query);
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pl"));

  itemsBody.innerHTML = "";

  for (const item of filtered) {
    const row = rowTemplate.content.cloneNode(true);
    row.querySelector('[data-field="name"]').textContent = item.name;
    row.querySelector('[data-field="sku"]').textContent = item.sku;
    row.querySelector('[data-field="quantity"]').textContent = item.quantity;
    row.querySelector('[data-field="minStock"]').textContent = item.minStock;
    row.querySelector('[data-field="location"]').textContent = item.location;

    const statusEl = row.querySelector('[data-field="status"]');
    const status = getStatus(item);
    statusEl.innerHTML = `<span class="status-pill ${status === "OK" ? "status-ok" : "status-low"}">${status}</span>`;

    row.querySelector('[data-action="edit"]').addEventListener("click", () => {
      fillForm(item);
      fields.name.focus();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    row.querySelector('[data-action="delete"]').addEventListener("click", () => {
      if (!confirm(`Usunąć ${item.name}?`)) return;
      items = items.filter((entry) => entry.sku !== item.sku);
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
    name: fields.name.value.trim(),
    sku: fields.sku.value.trim(),
    quantity: Number(fields.quantity.value),
    location: fields.location.value.trim(),
    minStock: Number(fields.minStock.value),
  };

  if (!payload.name || !payload.sku || Number.isNaN(payload.quantity)) {
    alert("Uzupełnij poprawnie formularz.");
    return;
  }

  if (editingSku && editingSku !== payload.sku) {
    payload.sku = editingSku;
  }

  upsertItem(payload);
  saveItems();
  renderRows();
  resetForm();
});

searchInput.addEventListener("input", renderRows);

renderRows();
