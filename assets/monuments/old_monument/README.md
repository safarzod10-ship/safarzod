# Старый памятник (только хранение)

Файл `old_monument.glb` лежит здесь **только для хранения**: не используется ни в одной сцене,
не внесён в AssetRegistry и исключён из Android-экспорта (`export_presets.cfg`).

- Источник: артефакт https://claude.ai/artifact/V319FyaEBZx5atFp4i7bg3, папка `oldmonument/`
  (оригиналы без изменений: `source_assets/artifact_V319FyaEBZx5atFp4i7bg3/oldmonument/`, SHA-256 в `SHA256SUMS`).
- Конвертация: `tools/blender/build_glb_from_artifact.py ... oldmonument ...` (отчёт `docs/reports/oldmonument_blender.json`).
- 1 036 280 вершин, 1 929 803 треугольника, PBR-текстуры 4096²; round-trip без потерь, glTF-валидатор без ошибок.
- Масштаб в источнике нормализован (высота 0.842); в GLB применён **условный** ×24 (≈21 × 20 × 23.5 м). Реальный размер неизвестен.
- Для мобильной игры модель слишком тяжёлая: перед использованием нужна ретопология/LOD и уменьшение текстур.
