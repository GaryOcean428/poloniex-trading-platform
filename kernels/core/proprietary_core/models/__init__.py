"""
Pydantic Models for API Validation

These models mirror the Zod schemas in the TypeScript frontend,
ensuring consistent validation across the stack.
"""

from datetime import datetime
from enum import Enum
from typing import Optional, Generic, TypeVar
from pydantic import BaseModel, Field, field_validator, ConfigDict


class TradeSide(str, Enum):
    """Trade side enum"""
    BUY = "buy"
    SELL = "sell"


class TradeStatus(str, Enum):
    """Trade status enum"""
    PENDING = "pending"
    EXECUTED = "executed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class MarketData(BaseModel):
    """Market data model"""
    model_config = ConfigDict(str_strip_whitespace=True)
    
    symbol: str = Field(..., min_length=1, description="Trading pair symbol")
    timestamp: datetime = Field(..., description="Data timestamp")
    price: float = Field(..., gt=0, description="Current price")
    volume: float = Field(..., ge=0, description="Trading volume")
    high: Optional[float] = Field(None, gt=0, description="High price")
    low: Optional[float] = Field(None, gt=0, description="Low price")
    open: Optional[float] = Field(None, gt=0, description="Open price")
    close: Optional[float] = Field(None, gt=0, description="Close price")

    @field_validator('symbol')
    @classmethod
    def validate_symbol(cls, v: str) -> str:
        """Validate symbol format"""
        if not v or v.isspace():
            raise ValueError("Symbol cannot be empty")
        return v.upper()


class Trade(BaseModel):
    """Trade model"""
    model_config = ConfigDict(str_strip_whitespace=True)
    
    id: Optional[str] = Field(None, description="Trade ID")
    symbol: str = Field(..., min_length=1, description="Trading pair symbol")
    side: TradeSide = Field(..., description="Trade side (buy/sell)")
    quantity: float = Field(..., gt=0, description="Trade quantity")
    price: float = Field(..., gt=0, description="Trade price")
    status: TradeStatus = Field(..., description="Trade status")
    executed_at: Optional[datetime] = Field(None, description="Execution timestamp")
    created_at: datetime = Field(default_factory=datetime.now, description="Creation timestamp")


class User(BaseModel):
    """User model"""
    model_config = ConfigDict(str_strip_whitespace=True)
    
    id: Optional[str] = Field(None, description="User ID")
    username: str = Field(..., min_length=3, max_length=50, description="Username")
    email: str = Field(..., description="Email address")
    created_at: Optional[datetime] = Field(None, description="Creation timestamp")
    updated_at: Optional[datetime] = Field(None, description="Update timestamp")

    @field_validator('email')
    @classmethod
    def validate_email(cls, v: str) -> str:
        """Basic email validation"""
        if '@' not in v or '.' not in v.split('@')[1]:
            raise ValueError("Invalid email format")
        return v.lower()


# Generic response wrapper
T = TypeVar('T')


class ApiResponse(BaseModel, Generic[T]):
    """Generic API response wrapper"""
    success: bool = Field(..., description="Success status")
    data: Optional[T] = Field(None, description="Response data")
    error: Optional[str] = Field(None, description="Error message")
    message: Optional[str] = Field(None, description="Additional message")


class HealthResponse(BaseModel):
    """Health check response"""
    status: str = Field(..., description="Service status")
    timestamp: datetime = Field(default_factory=datetime.now)
    version: str = Field(..., description="Service version")
