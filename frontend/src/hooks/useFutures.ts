import { useContext } from 'react';
import { FuturesContext } from '../context/FuturesContext';

export const useFutures = () => useContext(FuturesContext);