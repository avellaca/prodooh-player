<?php

namespace Tests\Unit;

use App\Jobs\FireTrackingPixelJob;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

class FireTrackingPixelJobTest extends TestCase
{
    public function test_successful_fire_makes_http_get_to_pixel_url(): void
    {
        Http::fake([
            'https://tracker.example.com/pixel*' => Http::response('', 200),
        ]);

        $job = new FireTrackingPixelJob(
            pixelUrl: 'https://tracker.example.com/pixel?id=123',
            creativeId: 'creative-001',
            impressionId: 'impression-001',
            multiplier: 1,
        );

        $job->handle();

        Http::assertSentCount(1);
        Http::assertSent(function ($request) {
            return $request->url() === 'https://tracker.example.com/pixel?id=123'
                && $request->method() === 'GET';
        });
    }

    public function test_failure_throws_runtime_exception_for_retry(): void
    {
        Http::fake([
            'https://tracker.example.com/pixel*' => Http::response('Server Error', 500),
        ]);

        $job = new FireTrackingPixelJob(
            pixelUrl: 'https://tracker.example.com/pixel?id=123',
            creativeId: 'creative-001',
            impressionId: 'impression-001',
        );

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Pixel fire failed: HTTP 500');

        $job->handle();
    }

    public function test_permanent_failure_logs_error(): void
    {
        Log::shouldReceive('error')
            ->once()
            ->with('TrackingPixel fire permanently failed', \Mockery::on(function ($context) {
                return $context['url'] === 'https://tracker.example.com/pixel?id=fail'
                    && $context['creative_id'] === 'creative-002'
                    && $context['impression_id'] === 'impression-002'
                    && str_contains($context['error'], 'Something went wrong');
            }));

        $job = new FireTrackingPixelJob(
            pixelUrl: 'https://tracker.example.com/pixel?id=fail',
            creativeId: 'creative-002',
            impressionId: 'impression-002',
        );

        $exception = new \RuntimeException('Something went wrong');
        $job->failed($exception);
    }

    public function test_multiplier_fires_n_times(): void
    {
        Http::fake([
            'https://tracker.example.com/pixel*' => Http::response('', 200),
        ]);

        $multiplier = 3;
        $job = new FireTrackingPixelJob(
            pixelUrl: 'https://tracker.example.com/pixel?id=multi',
            creativeId: 'creative-003',
            impressionId: 'impression-003',
            multiplier: $multiplier,
        );

        $job->handle();

        Http::assertSentCount($multiplier);
    }

    public function test_job_has_correct_retry_configuration(): void
    {
        $job = new FireTrackingPixelJob(
            pixelUrl: 'https://tracker.example.com/pixel',
            creativeId: 'creative-001',
            impressionId: 'impression-001',
        );

        $this->assertEquals(4, $job->tries);
        $this->assertEquals([10, 60, 300], $job->backoff);
    }

    public function test_multiplier_default_is_one(): void
    {
        $job = new FireTrackingPixelJob(
            pixelUrl: 'https://tracker.example.com/pixel',
            creativeId: 'creative-001',
            impressionId: 'impression-001',
        );

        $this->assertEquals(1, $job->multiplier);
    }

    public function test_failure_on_nth_request_in_multiplier_loop_throws(): void
    {
        Http::fake([
            'https://tracker.example.com/pixel*' => Http::sequence()
                ->push('', 200)
                ->push('', 200)
                ->push('Service Unavailable', 503),
        ]);

        $job = new FireTrackingPixelJob(
            pixelUrl: 'https://tracker.example.com/pixel?id=partial',
            creativeId: 'creative-004',
            impressionId: 'impression-004',
            multiplier: 3,
        );

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Pixel fire failed: HTTP 503');

        $job->handle();
    }
}
