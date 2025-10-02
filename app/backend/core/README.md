# Содержимое папки: app/backend/core

Файлы:
- `__init__.py` — инициализация подпакета core.
- `config.py` — конфигурация приложения (pydantic‑settings): URL БД, S3/MinIO, корневые пути и др.
- `database.py` — создание `Engine`/`Session` SQLAlchemy, контекст `session_scope`, dependency `get_session`/`get_engine`.

