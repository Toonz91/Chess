import { createContext, useContext } from 'react';
import { AnalysisService } from '../core/engine/AnalysisService';
import { createWorkerTransport } from '../core/engine/UciEngine';
import { GameHistory } from '../core/history';

export interface Services {
  service: AnalysisService;
  history: GameHistory;
}

export function createServices(): Services {
  const url = `${import.meta.env.BASE_URL}engine/stockfish-19-lite-single.js`;
  return {
    service: new AnalysisService(() => createWorkerTransport(url)),
    history: new GameHistory(),
  };
}

export const ServicesContext = createContext<Services | null>(null);

export function useServices(): Services {
  const s = useContext(ServicesContext);
  if (!s) throw new Error('ServicesContext missing');
  return s;
}
