from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
import models, database

# 1. Автоматическое создание таблиц
models.Base.metadata.create_all(bind=database.engine)

app = FastAPI()

# 2. Настройка CORS (чтобы фронтенд мог слать запросы)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 3. Схемы данных (вместо schemas.py)
class ListingBase(BaseModel):
    title: str
    price: float
    description: Optional[str] = None
    photo: Optional[str] = None

class ListingCreate(ListingBase):
    pass

class Listing(ListingBase):
    id: int
    class Config:
        from_attributes = True

# 4. Подключение к БД
def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()

# 5. Эндпоинты (Маршруты)

@app.get("/api/listings", response_model=List[Listing])
def get_listings(db: Session = Depends(get_db)):
    # Запрашиваем из базы и превращаем в формат для фронтенда
    db_listings = db.query(models.Listing).order_by(models.Listing.id.desc()).all()
    
    # Небольшой маппинг, чтобы фронтенд понимал названия полей
    results = []
    for item in db_listings:
        results.append({
            "id": item.id,
            "title": item.title,
            "price": item.price_fiat,
            "description": item.description,
            "photo": item.images[0] if item.images and len(item.images) > 0 else None
        })
    return results

@app.post("/api/listings", response_model=Listing)
def create_listing(listing: ListingCreate, db: Session = Depends(get_db)):
    # Создаем запись в базе. owner_id ставим 1 (убедись, что такой юзер есть в Supabase!)
    db_listing = models.Listing(
        title=listing.title,
        description=listing.description,
        price_fiat=listing.price,
        owner_id=1,
        images=[listing.photo] if listing.photo else []
    )
    db.add(db_listing)
    db.commit()
    db.refresh(db_listing)
    
    # Возвращаем созданный объект в формате схемы
    return {
        "id": db_listing.id,
        "title": db_listing.title,
        "price": db_listing.price_fiat,
        "description": db_listing.description,
        "photo": db_listing.images[0] if db_listing.images else None
    }