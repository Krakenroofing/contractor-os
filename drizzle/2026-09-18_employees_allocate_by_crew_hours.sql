-- Salaried supervision/support who never punch: spread their weekly pay
-- across the jobs the crew worked (weighted by posted crew wages) instead
-- of parking it in overhead. Flagged: Daniel Newberg, Lance Seymour,
-- Keidelle Parris (TRB).
ALTER TABLE employees ADD COLUMN allocate_by_crew_hours boolean NOT NULL DEFAULT false;
UPDATE employees SET allocate_by_crew_hours = true
WHERE company_id = '81fe6373-8027-4ae6-a516-d0914ea7116f'
  AND (first_name || ' ' || last_name) IN ('Daniel Newberg', 'Lance Seymour', 'Keidelle Parris');
