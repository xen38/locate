# Read-Only Sessions

Original session files are never copied, moved, modified, or duplicated. Syn maintains a lightweight metadata database and search index that never touches the original session archives.

All reads are read-only. Indexing only extracts metadata and content for search; it does not write back to source files.
