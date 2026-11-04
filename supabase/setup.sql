-- Da eseguire UNA volta dopo 0001_init.sql, con i tuoi valori.
update public.settings
   set org_name        = 'Turni Supporto',
       allowed_domains = '{azienda.it}',          -- dominio delle email aziendali
       admin_emails    = '{carlo@azienda.it}',    -- chi diventa amministratore al primo accesso
       timezone        = 'Europe/Rome',
       min_rest_hours  = 11
 where id = 1;
