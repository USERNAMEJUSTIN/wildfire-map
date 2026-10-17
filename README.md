# Карта лесных пожаров мира

Текущие пожары работают без ключа (публичные файлы NASA FIRMS).
Архив по датам (с 2000 года) включается бесплатным ключом: https://firms.modaps.eosdis.nasa.gov/api/map_key/

## Запуск на своём компьютере
Нужен Node.js 18+.
```
node server.js
```
С архивом:
```
FIRMS_MAP_KEY=ваш_ключ node server.js
```
Откройте http://localhost:3000

## Публикация в интернет (бесплатно, Render)
1. Загрузите папку в репозиторий GitHub.
2. render.com → New → Blueprint → выберите репозиторий (используется render.yaml).
3. Вставьте FIRMS_MAP_KEY (или оставьте пустым — будет только режим «Сейчас»).

## Docker
```
docker build -t wildfire-map . && docker run -p 3000:3000 -e FIRMS_MAP_KEY=ваш_ключ wildfire-map
```
