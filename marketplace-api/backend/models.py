from sqlalchemy import Column, Integer, String, Float, ForeignKey, ARRAY
from sqlalchemy.orm import relationship  # ДОБАВИЛИ ЭТУ СТРОКУ
from database import Base

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    password_hash = Column(String)
    solana_wallet_address = Column(String, unique=True, nullable=True)
    
    # Теперь это будет работать
    listings = relationship("Listing", back_populates="owner")
    orders = relationship("Order", back_populates="user")

class Listing(Base):
    __tablename__ = "listings"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String)
    description = Column(String)
    price_fiat = Column(Float)
    price_crypto = Column(Float)
    lat = Column(Float)
    lng = Column(Float)
    area = Column(Float)
    floor = Column(Integer)
    images = Column(ARRAY(String))
    token_mint_address = Column(String, unique=True, nullable=True)
    
    owner_id = Column(Integer, ForeignKey("users.id"))
    owner = relationship("User", back_populates="listings")

class Order(Base):
    __tablename__ = "orders"
    id = Column(Integer, primary_key=True, index=True)
    listing_id = Column(Integer, ForeignKey("listings.id"))
    user_id = Column(Integer, ForeignKey("users.id"))
    status = Column(String, default="Created")
    tx_hash = Column(String, nullable=True)
    
    user = relationship("User", back_populates="orders")