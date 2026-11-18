-- Rebrand visual: o verde antigo (#C5F812) vira o lilás do UNISON (#C9A0DC).
-- Atualiza apenas valores que ainda usam exatamente o accent padrão antigo.
UPDATE user_settings SET accent = '#C9A0DC' WHERE accent = '#C5F812';
UPDATE space_roles SET color = '#C9A0DC' WHERE color = '#C5F812';
