import http from 'k6/http';
import { sleep } from 'k6';

export const options = {
  vus: 50,
  duration: '30s',
};

export default function () {
  http.post('http://localhost:45800/sync', JSON.stringify({ action: 'sync' }));
  sleep(1);
}
