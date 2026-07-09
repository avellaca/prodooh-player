import { useState } from 'react';
import { format, subDays } from 'date-fns';
import { Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { LoadingState } from '@/components/shared/LoadingState';
import { useAnalytics } from '../hooks';

const today = format(new Date(), 'yyyy-MM-dd');
const sevenDaysAgo = format(subDays(new Date(), 7), 'yyyy-MM-dd');

export default function AnalyticsPage() {
  const [startDate, setStartDate] = useState(sevenDaysAgo);
  const [endDate, setEndDate] = useState(today);
  const [queryParams, setQueryParams] = useState<{ start: string; end: string } | null>(null);

  const { data, isLoading } = useAnalytics(
    queryParams?.start ?? '',
    queryParams?.end ?? '',
    queryParams !== null
  );

  function handleConsultar() {
    setQueryParams({ start: startDate, end: endDate });
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Analytics de reproducción</h1>

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <Label htmlFor="start-date">Fecha inicio</Label>
          <Input
            id="start-date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="end-date">Fecha fin</Label>
          <Input
            id="end-date"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>

        <Button onClick={handleConsultar}>
          <Search className="mr-2 h-4 w-4" />
          Consultar
        </Button>
      </div>

      {isLoading && <LoadingState rows={5} />}

      {data && (
        <div className="space-y-6">
          {/* Summary card */}
          <Card>
            <CardHeader>
              <CardTitle>Total de spots</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-4xl font-bold">{data.total_spots.toLocaleString()}</p>
            </CardContent>
          </Card>

          {/* By source breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>Por fuente</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fuente</TableHead>
                    <TableHead className="text-right">Reproducciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(data.by_source).map(([source, count]) => (
                    <TableRow key={source}>
                      <TableCell>{source}</TableCell>
                      <TableCell className="text-right">{count.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                  {Object.keys(data.by_source).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={2} className="text-center text-muted-foreground">
                        Sin datos
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* By screen breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>Por pantalla</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Screen ID</TableHead>
                    <TableHead className="text-right">Reproducciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.by_screen.map((item) => (
                    <TableRow key={item.screen_id}>
                      <TableCell className="font-mono text-sm">{item.screen_id}</TableCell>
                      <TableCell className="text-right">{item.count.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                  {data.by_screen.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={2} className="text-center text-muted-foreground">
                        Sin datos
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* By content breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>Por contenido</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Content ID</TableHead>
                    <TableHead className="text-right">Reproducciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.by_content.map((item) => (
                    <TableRow key={item.content_id}>
                      <TableCell className="font-mono text-sm">{item.content_id}</TableCell>
                      <TableCell className="text-right">{item.count.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                  {data.by_content.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={2} className="text-center text-muted-foreground">
                        Sin datos
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
