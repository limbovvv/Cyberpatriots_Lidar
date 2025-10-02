# Содержимое папки: app/backend/models

Файлы:
- `__init__.py` — инициализация подпакета моделей.
- `base.py` — базовые классы ORM: `Base` (Declarative) и `UUIDMixin`.
- `dataset.py` — модель `Dataset` и перечисление статусов `DatasetStatus`.
- `job.py` — модель фоновой задачи `Job` и перечисления `JobKind`/`JobStatus`.
- `mask.py` — модель `Mask` (хранение масок удаления точек).
- `session.py` — модели `Session` и `Operation` для истории правок.
- `tile.py` — модель `Tile` для геометрических тайлов точек.

