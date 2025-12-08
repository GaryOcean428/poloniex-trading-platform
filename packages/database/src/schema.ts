// Database schema definitions using Drizzle ORM
// This file will contain table definitions for the platform

import { pgTable, serial, text, timestamp, decimal, boolean, integer } from 'drizzle-orm/pg-core';

// Example schema - to be expanded based on actual requirements
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const trades = pgTable('trades', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  symbol: text('symbol').notNull(),
  side: text('side').notNull(), // 'buy' or 'sell'
  quantity: decimal('quantity', { precision: 18, scale: 8 }).notNull(),
  price: decimal('price', { precision: 18, scale: 8 }).notNull(),
  status: text('status').notNull(), // 'pending', 'executed', 'failed'
  executedAt: timestamp('executed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const marketData = pgTable('market_data', {
  id: serial('id').primaryKey(),
  symbol: text('symbol').notNull(),
  timestamp: timestamp('timestamp').notNull(),
  open: decimal('open', { precision: 18, scale: 8 }).notNull(),
  high: decimal('high', { precision: 18, scale: 8 }).notNull(),
  low: decimal('low', { precision: 18, scale: 8 }).notNull(),
  close: decimal('close', { precision: 18, scale: 8 }).notNull(),
  volume: decimal('volume', { precision: 18, scale: 8 }).notNull(),
});
