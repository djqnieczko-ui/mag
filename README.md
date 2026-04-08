# Magazyn - aplikacja WWW

Lekka aplikacja do zarządzania stanami magazynowymi (HTML/CSS/JS), gotowa do publikacji na GitHub Pages.

## Funkcje
- Dzial, producent, kategoria, nazwa, waga, ilosc, kod urzadzenia
- Dodawanie, edycja i usuwanie pozycji
- Import CSV z mapowaniem naglowkow
- Wyszukiwanie po wielu polach
- Dane przechowywane w Supabase (darmowa chmura)

## Konfiguracja Supabase (Free)
1. Zaloz projekt w Supabase.
2. Otworz SQL Editor i uruchom skrypt z pliku `supabase.sql`.
3. Otworz `Project Settings > API` i skopiuj:
    - `Project URL`
    - `anon public key`
4. W pliku `config.js` uzupelnij:

```javascript
window.APP_CONFIG = {
   supabaseUrl: "https://twoj-projekt.supabase.co",
   supabaseAnonKey: "twoj-anon-key",
};
```

5. Wypchnij zmiany na GitHub.
6. Po wdrozeniu strona pokaze w naglowku tryb: `Dane: Supabase (cloud)`.

## Automatyczne migracje Supabase z GitHub Actions
1. W Supabase przejdz do `Project Settings > Database` i skopiuj `Connection string` dla roli `postgres`.
2. W GitHub repo przejdz do `Settings > Secrets and variables > Actions`.
3. Dodaj sekret `SUPABASE_DB_URL` z wartoscia connection string.
4. Workflow `Supabase schema migration` uruchomi sie automatycznie po zmianie pliku `supabase.sql` na galezi `main`.
5. Możesz uruchomic workflow recznie z zakladki `Actions` przez `Run workflow`.

## Publikacja online (GitHub Pages)
1. W repozytorium GitHub przejdz do `Settings > Pages`.
2. W `Build and deployment` ustaw `Source: GitHub Actions`.
3. Wypchnij kod na galez `main`.
4. Sprawdz workflow `Deploy static site to GitHub Pages` w zakladce `Actions`.
5. Adres strony: `https://<twoj-login>.github.io/<nazwa-repo>/`
