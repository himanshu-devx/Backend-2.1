-- Partitioning Strategy for Journal Lines
-- Grouping by month is a common standard for banking ledgers.

-- Ensure parent table exists (defined in schema.sql)
-- In a real migration system, we might convert the table here, but we assume it was created with partitioning in mind if we were doing this from scratch.
-- For this "kernel", we provide the logic to attach partitions.

-- Example function to create partitions automatically
CREATE OR REPLACE FUNCTION create_journal_partitions(start_date DATE, months_forward INT) RETURNS VOID AS $$
DECLARE
    date_iter DATE := DATE_TRUNC('month', start_date);
    end_date DATE := DATE_TRUNC('month', start_date) + (months_forward || ' months')::INTERVAL;
    partition_name TEXT;
    start_str TEXT;
    end_str TEXT;
BEGIN
    WHILE date_iter < end_date LOOP
        partition_name := 'journal_lines_' || TO_CHAR(date_iter, 'YYYY_MM');
        start_str := TO_CHAR(date_iter, 'YYYY-MM-DD');
        end_str := TO_CHAR(date_iter + INTERVAL '1 month', 'YYYY-MM-DD');
        
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF journal_lines FOR VALUES FROM (%L) TO (%L)',
            partition_name, start_str, end_str
        );
        
        -- Indexes are automatically inherited, but we can verify or add specific ones if needed.
        
        date_iter := date_iter + INTERVAL '1 month';
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Initial execution for ensuring current and next month exist
SELECT create_journal_partitions(CURRENT_DATE, 3);
