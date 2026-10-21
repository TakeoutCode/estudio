-- QUALITY QA7: filas exactas de cada tabla del esquema public, una por línea (`tabla|filas`),
-- para comparar la base con su copia restaurada. Solo nombres y conteos: nada de contenido.
SELECT format('%s|%s', table_name,
       (xpath('/row/n/text()',
              query_to_xml(format('SELECT count(*) AS n FROM public.%I', table_name), false, true, '')))[1]::text)
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;
