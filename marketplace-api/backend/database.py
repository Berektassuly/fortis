# backend/database.py
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

SQLALCHEMY_DATABASE_URL = "postgresql://postgres.xokagjbroveeebqjxwsg:pidorasov1488@aws-1-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require"

# Убираем проблемный executemany_mode, оставляем только самое важное
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    pool_pre_ping=True
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()