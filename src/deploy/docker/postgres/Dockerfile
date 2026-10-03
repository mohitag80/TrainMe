# PostgreSQL 17 + pg_partman (monthly partitions for records_db, LLD §2.3).
# The same extensions exist on Amazon RDS, so local, k3s and AWS behave alike.
FROM postgres:17.11-trixie
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-17-partman \
 && rm -rf /var/lib/apt/lists/*
COPY bootstrap-databases.sh /usr/local/bin/bootstrap-databases.sh
RUN ln -s /usr/local/bin/bootstrap-databases.sh /docker-entrypoint-initdb.d/10-bootstrap-databases.sh
