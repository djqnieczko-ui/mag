const buildVersion = document.getElementById("build-version");
const dataMode = document.getElementById("data-mode");
const nipForm = document.getElementById("nip-form");
const nipInput = document.getElementById("company-nip");
const searchCompanyButton = document.getElementById("search-company");
const lookupResult = document.getElementById("lookup-result");
const companySummaryCard = document.getElementById("company-summary-card");
const companyListsCard = document.getElementById("company-lists-card");
const companyRawCard = document.getElementById("company-raw-card");
const companyTitle = document.getElementById("company-title");
const companyMeta = document.getElementById("company-meta");
const companyStats = document.getElementById("company-stats");
const companyDetails = document.getElementById("company-details");
const bankAccounts = document.getElementById("bank-accounts");
const representatives = document.getElementById("representatives");
const authorizedClerks = document.getElementById("authorized-clerks");
const partners = document.getElementById("partners");
const companyRawDetails = document.getElementById("company-raw-details");
const sourceStatus = document.getElementById("source-status");
const sourceLinks = document.getElementById("source-links");

const MF_API_BASE = "https://wl-api.mf.gov.pl/api/search/nip";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeNip(value) {
  return String(value || "").replace(/\D/g, "");
}

function isValidNip(nip) {
  if (!/^\d{10}$/.test(nip)) return false;
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const checksum = weights.reduce((sum, weight, index) => sum + (Number(nip[index]) * weight), 0) % 11;
  return checksum !== 10 && checksum === Number(nip[9]);
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

function formatDate(value) {
  if (!value || value === "null") return "-";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pl-PL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function getTodayIsoDate() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function loadBuildVersion() {
  if (!buildVersion) return;

  fetch(`build-info.json?ts=${Date.now()}`, { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error("Brak metadanych");
      return response.json();
    })
    .then((info) => {
      const shortCommit = String(info.commit || "").slice(0, 7) || "lokalna";
      buildVersion.textContent = `Wersja: ${shortCommit} • ${formatDateTime(info.deployedAt)}`;
    })
    .catch(() => {
      buildVersion.textContent = "Wersja: lokalna";
    });
}

function renderDataMode(status = "Dane: MF Wykaz VAT + oficjalne linki") {
  if (dataMode) dataMode.textContent = status;
}

function setLookupResult(message = "", type = "") {
  lookupResult.textContent = message;
  lookupResult.className = `csv-result${type ? ` ${type}` : ""}`;
}

function hideResults() {
  companySummaryCard.hidden = true;
  companyListsCard.hidden = true;
  companyRawCard.hidden = true;
}

function renderDetailSummary(container, entries) {
  container.innerHTML = entries
    .filter((entry) => entry[1] !== undefined && entry[1] !== null && entry[1] !== "")
    .map(([label, value]) => `<div class="detail-chip"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join("");
}

function renderRawDetails(container, details) {
  const rows = Object.entries(details)
    .filter(([, value]) => !Array.isArray(value))
    .map(([key, value]) => {
      const normalizedValue = value === null || value === undefined || value === "" ? "-" : String(value);
      return `<div class="detail-chip"><span>${escapeHtml(key)}</span><code>${escapeHtml(normalizedValue)}</code></div>`;
    });
  container.innerHTML = rows.join("");
}

function renderList(container, items, formatter) {
  if (!items || !items.length) {
    container.innerHTML = '<div class="empty-state">Brak danych.</div>';
    return;
  }

  container.innerHTML = items.map(formatter).join("");
}

function renderSourceSection(subject) {
  renderDetailSummary(sourceStatus, [
    ["MF Wykaz VAT", "Aktywny odczyt online"],
    ["GUS REGON", "API wymaga tokenu i nie jest bezpieczne do osadzenia w statycznym froncie"],
    ["KRS", subject.krs ? `Numer dostepny: ${subject.krs}` : "Brak numeru KRS w odpowiedzi MF"],
    ["CEIDG", "Oficjalna wyszukiwarka do dalszej weryfikacji"],
  ]);

  const ceidgQuery = encodeURIComponent(subject.nip || subject.name || "");
  sourceLinks.innerHTML = [
    {
      label: "MF Wykaz VAT",
      value: "Publiczne API odczytane automatycznie na tej stronie.",
      href: subject.nip
        ? `${MF_API_BASE}/${encodeURIComponent(subject.nip)}?date=${getTodayIsoDate()}`
        : "https://wl-api.mf.gov.pl/",
    },
    {
      label: "Portal API GUS REGON",
      value: "Dokumentacja i rejestracja tokenu API.",
      href: "https://api.stat.gov.pl/Home/Index",
    },
    {
      label: "Wyszukiwarka KRS",
      value: subject.krs ? `Sprawdz numer KRS ${subject.krs} w oficjalnej wyszukiwarce.` : "Otworz oficjalna wyszukiwarke KRS.",
      href: "https://ekrs.ms.gov.pl/web/wyszukiwarka-krs/strona-glowna/",
    },
    {
      label: "Wyszukiwarka CEIDG",
      value: "Otworz oficjalna wyszukiwarke CEIDG po NIP lub nazwie.",
      href: `https://aplikacja.ceidg.gov.pl/CEIDG/CEIDG.Public.UI/Search.aspx?Query=${ceidgQuery}`,
    },
  ]
    .map((link) => `
      <a class="source-link" href="${escapeHtml(link.href)}" target="_blank" rel="noreferrer noopener">
        <strong>${escapeHtml(link.label)}</strong>
        <span>${escapeHtml(link.value)}</span>
      </a>
    `)
    .join("");
}

function renderSubject(subject, requestDateTime, requestId) {
  companySummaryCard.hidden = false;
  companyListsCard.hidden = false;
  companyRawCard.hidden = false;

  companyTitle.textContent = subject.name || "Nie znaleziono nazwy podmiotu";
  companyMeta.textContent = `Zapytanie z ${requestDateTime || "nieznanego czasu"} • requestId: ${requestId || "brak"}`;

  companyStats.innerHTML = [
    ["NIP", subject.nip || "-"],
    ["REGON", subject.regon || "-"],
    ["KRS", subject.krs || "-"],
    ["Status VAT", subject.statusVat || "-"],
    ["Rachunki", Array.isArray(subject.accountNumbers) ? subject.accountNumbers.length : 0],
    ["Wirtualne rachunki", subject.hasVirtualAccounts ? "Tak" : "Nie"],
  ]
    .map(([label, value]) => `<div class="stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join("");

  renderDetailSummary(companyDetails, [
    ["Nazwa", subject.name || "-"],
    ["NIP", subject.nip || "-"],
    ["REGON", subject.regon || "-"],
    ["KRS", subject.krs || "-"],
    ["Status VAT", subject.statusVat || "-"],
    ["Adres siedziby", subject.residenceAddress || "-"],
    ["Adres dzialalnosci", subject.workingAddress || "-"],
    ["Data rejestracji VAT", formatDate(subject.registrationLegalDate)],
    ["Data odmowy rejestracji", formatDate(subject.registrationDenialDate)],
    ["Podstawa odmowy", subject.registrationDenialBasis || "-"],
    ["Data przywrocenia", formatDate(subject.restorationDate)],
    ["Podstawa przywrocenia", subject.restorationBasis || "-"],
    ["Data usuniecia", formatDate(subject.removalDate)],
    ["Podstawa usuniecia", subject.removalBasis || "-"],
    ["Data SME", formatDate(subject.exemptionSmeDate)],
  ]);

  renderList(bankAccounts, subject.accountNumbers || [], (account) => `
    <div class="lookup-pill">
      <strong>${escapeHtml(account)}</strong>
      <span>Rachunek z wykazu VAT</span>
    </div>
  `);

  const personFormatter = (person) => {
    const fullName = [person.firstName, person.lastName].filter(Boolean).join(" ") || person.companyName || "Brak nazwy";
    const meta = [
      person.companyName && person.companyName !== fullName ? person.companyName : "",
      person.nip ? `NIP: ${person.nip}` : "",
      person.pesel ? `PESEL: ${person.pesel}` : "",
    ]
      .filter(Boolean)
      .join(" • ");
    return `
      <div class="lookup-pill">
        <strong>${escapeHtml(fullName)}</strong>
        <span>${escapeHtml(meta || "Brak dodatkowych danych")}</span>
      </div>
    `;
  };

  renderList(representatives, subject.representatives || [], personFormatter);
  renderList(authorizedClerks, subject.authorizedClerks || [], personFormatter);
  renderList(partners, subject.partners || [], personFormatter);
  renderRawDetails(companyRawDetails, subject);
  renderSourceSection(subject);
}

async function fetchSubjectByNip(nip) {
  const response = await fetch(`${MF_API_BASE}/${encodeURIComponent(nip)}?date=${getTodayIsoDate()}`, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Blad odpowiedzi API MF: ${response.status}`);
  }

  const payload = await response.json();
  const result = payload?.result || null;
  const subject = result?.subject || null;

  if (!subject) {
    throw new Error("Nie znaleziono danych dla podanego NIP.");
  }

  return {
    subject,
    requestId: result.requestId || "",
    requestDateTime: result.requestDateTime || "",
  };
}

async function searchByNip(rawNip) {
  const nip = normalizeNip(rawNip);

  if (!isValidNip(nip)) {
    hideResults();
    setLookupResult("Podaj poprawny 10-cyfrowy numer NIP.", "error");
    return;
  }

  searchCompanyButton.disabled = true;
  setLookupResult("Szukanie danych w publicznym wykazie MF...", "");

  try {
    const { subject, requestId, requestDateTime } = await fetchSubjectByNip(nip);
    renderSubject(subject, requestDateTime, requestId);
    setLookupResult(`Pobrano dane podmiotu ${subject.name || nip}.`, "success");

    const url = new URL(window.location.href);
    url.searchParams.set("nip", nip);
    window.history.replaceState({}, "", url);
  } catch (error) {
    hideResults();
    renderSourceSection({ nip, krs: "", name: "" });
    setLookupResult(error.message || "Nie udalo sie pobrac danych.", "error");
  } finally {
    searchCompanyButton.disabled = false;
  }
}

nipForm.addEventListener("submit", (event) => {
  event.preventDefault();
  searchByNip(nipInput.value);
});

function init() {
  loadBuildVersion();
  renderDataMode();
  renderSourceSection({ nip: "", krs: "", name: "" });

  const params = new URLSearchParams(window.location.search);
  const initialNip = normalizeNip(params.get("nip") || "");
  if (initialNip) {
    nipInput.value = initialNip;
    searchByNip(initialNip);
  }
}

init();