-- Allow PDF as a document source.

alter table public.document_versions drop constraint document_versions_source_type_check;
alter table public.document_versions
  add constraint document_versions_source_type_check check (source_type in ('text', 'docx', 'pdf'));
