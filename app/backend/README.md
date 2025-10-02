# Содержимое папки: app/backend

Файлы:
- `__init__.py` — инициализация пакета backend.
- `main.py` — приложение FastAPI: настройка и регистрация роутеров; создание схем БД при старте.
- `requirements.txt` — список зависимостей Python для backend‑сервиса.
- `storage.py` — локальное файловое хранилище датасетов (сырые файлы, тайлы, маски, экспорт).

ML (очистка облаков точек):
- `ml/` — простые эвристики и PyTorch‑инференс (PointNet/DGCNN) для предпросмотра/классификации кластеров.
- `services/ml_service.py` — оркестрация предпросмотра и применения маски; хранение превью в памяти процесса.
- `routers/ml.py` — REST‑эндпоинты `/ml`.

Как использовать (локально):
- Предпросмотр: `POST /ml/preview` c телом `{ dataset_path, eps, min_points, voxel_size, use_nn, checkpoint, model_type }` → `{ preview_id, stats }`.
- Детализация для визуализации: `GET /ml/preview/{preview_id}/detail` → `{ num_points, labels, clusters }` (индексы точек по кластерам).
- Применение: `POST /ml/apply` c телом `{ preview_id, classes_to_remove?, output_path }` → `{ output_path }`.

Примечания:
- Значение `voxel_size` по умолчанию — `0.05`, чтобы ускорить предпросмотр; установите `0.0`, если нужна 1:1 маска с исходным облаком.
- Параметр `target_classes` (список строк) позволяет управлять тем, какие классы попадут в предпросмотр и маску; при `null`/отсутствии используются стандартные (`car`, `person`, `vegetation`, `wire`, `pole`).
- Для выборочного удаления по классам используется объединение индексов кластеров из предпросмотра.
- Перед классификацией крупные кластеры детерминированно прорежаются до 4096 точек, чтобы не потреблять десятки гигабайт памяти при построении батча PyTorch.

Зависимости (requirements):
- Базовые: `fastapi`, `uvicorn`, `sqlalchemy`, `pydantic`, `pydantic-settings`, `python-multipart`, `python-lzf`.
- ML/обработка точек: `numpy`, `open3d`, `torch`.
- Инфраструктурные (опционально, закомментированы в requirements.txt): `psycopg2-binary`, `alembic`, `redis`, `celery`, `boto3`.

Примечание по установке ML-зависимостей:
- `torch` и `open3d` требуют колёса, совместимые с вашей ОС/CPU/CUDA. При необходимости укажите индекс PyTorch: `pip install --index-url https://download.pytorch.org/whl/cu121 torch==<версия>` или используйте CPU‑сборку.
