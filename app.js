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

function upsertItem(newItem) {
  const existingIndex = items.findIndex((item) => item.deviceCode === newItem.deviceCode);
  if (existingIndex >= 0) {
    items[existingIndex] = newItem;
  } else {
    items.push(newItem);
  }
}

function renderCategoryOptions(selectedDepartment, selectedCategory = "") {
  const categories = DEPARTMENT_CATEGORIES[selectedDepartment] || [];
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

renderCategoryOptions(fields.department.value);
renderRows();
