# Magazyn - prosta aplikacja WWW

To jest lekka aplikacja do zarządzania stanami magazynowymi (HTML/CSS/JS), gotowa do publikacji na GitHub Pages.

## Funkcje
- Dodawanie, edycja i usuwanie produktów
- Wyszukiwanie po nazwie, SKU i lokalizacji
- Podgląd niskiego stanu magazynowego
- Zapis danych w `localStorage` przeglądarki

## Uruchomienie lokalne
1. Otwórz plik `index.html` w przeglądarce.

## Publikacja online (GitHub Pages)
1. W repozytorium na GitHub wejdź w `Settings > Pages`.
2. W `Build and deployment` ustaw `Source: GitHub Actions`.
3. Wypchnij kod na gałąź `main`.
4. Wejdź w zakładkę `Actions` i poczekaj na workflow `Deploy static site to GitHub Pages`.
5. Po wdrożeniu strona będzie pod adresem:
   `https://<twoj-login>.github.io/<nazwa-repo>/`

## Szybkie komendy git
```powershell
git init
git add .
git commit -m "Start aplikacji magazynowej"
git branch -M main
git remote add origin https://github.com/<twoj-login>/<nazwa-repo>.git
git push -u origin main
```
