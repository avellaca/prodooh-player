<?php

namespace Tests\Unit;

use App\Models\AuditLog;
use App\Models\Order;
use App\Models\OrderLine;
use App\Services\AuditService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

class AuditServiceTest extends TestCase
{
    use RefreshDatabase;

    private AuditService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new AuditService();
    }

    public function test_log_creates_audit_entry_with_correct_auditable_type_and_id(): void
    {
        $order = Order::factory()->create();

        $this->service->log($order, 'created');

        $this->assertDatabaseHas('audit_logs', [
            'auditable_type' => Order::class,
            'auditable_id' => $order->id,
            'event_type' => 'created',
        ]);
    }

    public function test_log_stores_diff_for_field_modified_event(): void
    {
        $order = Order::factory()->create();

        $diff = [
            'field' => 'name',
            'old_value' => 'Old Name',
            'new_value' => 'New Name',
        ];

        $this->service->log($order, 'field_modified', $diff);

        $auditLog = AuditLog::where('auditable_id', $order->id)
            ->where('event_type', 'field_modified')
            ->first();

        $this->assertNotNull($auditLog);
        $this->assertEquals('name', $auditLog->diff['field']);
        $this->assertEquals('Old Name', $auditLog->diff['old_value']);
        $this->assertEquals('New Name', $auditLog->diff['new_value']);
    }

    public function test_log_records_explicit_user_id(): void
    {
        $order = Order::factory()->create();
        $user = \App\Models\User::factory()->create();

        $this->service->log($order, 'created', null, $user->id);

        $this->assertDatabaseHas('audit_logs', [
            'auditable_id' => $order->id,
            'user_id' => $user->id,
        ]);
    }

    public function test_log_resolves_authenticated_user_when_no_user_id_provided(): void
    {
        $user = \App\Models\User::factory()->create();
        $this->actingAs($user);

        $order = Order::factory()->create();

        $this->service->log($order, 'created');

        $this->assertDatabaseHas('audit_logs', [
            'auditable_id' => $order->id,
            'user_id' => $user->id,
        ]);
    }

    public function test_log_stores_null_user_id_when_no_auth_and_no_explicit_user(): void
    {
        $order = Order::factory()->create();

        $this->service->log($order, 'created');

        $this->assertDatabaseHas('audit_logs', [
            'auditable_id' => $order->id,
            'user_id' => null,
        ]);
    }

    public function test_log_records_created_at_timestamp(): void
    {
        Carbon::setTestNow('2025-06-15 10:30:00');

        $order = Order::factory()->create();

        $this->service->log($order, 'created');

        $auditLog = AuditLog::where('auditable_id', $order->id)->first();

        $this->assertNotNull($auditLog);
        $this->assertEquals('2025-06-15 10:30:00', $auditLog->created_at->format('Y-m-d H:i:s'));

        Carbon::setTestNow();
    }

    public function test_log_supports_all_valid_event_types(): void
    {
        // Create without observers to isolate AuditService direct calls
        $order = Order::withoutEvents(fn () => Order::factory()->create());

        $eventTypes = [
            'created',
            'field_modified',
            'status_changed',
            'creative_added',
            'creative_removed',
            'spots_modified',
            'name_changed',
            'target_added',
            'target_removed',
        ];

        foreach ($eventTypes as $eventType) {
            $this->service->log($order, $eventType);
        }

        $this->assertDatabaseCount('audit_logs', count($eventTypes));

        foreach ($eventTypes as $eventType) {
            $this->assertDatabaseHas('audit_logs', [
                'auditable_id' => $order->id,
                'event_type' => $eventType,
            ]);
        }
    }

    public function test_log_stores_null_diff_when_not_provided(): void
    {
        $order = Order::factory()->create();

        $this->service->log($order, 'status_changed');

        $auditLog = AuditLog::where('auditable_id', $order->id)->first();

        $this->assertNotNull($auditLog);
        $this->assertNull($auditLog->diff);
    }

    public function test_log_works_with_different_auditable_models(): void
    {
        $order = Order::factory()->create();
        $orderLine = OrderLine::factory()->create(['order_id' => $order->id]);

        $this->service->log($order, 'created');
        $this->service->log($orderLine, 'created');

        $this->assertDatabaseHas('audit_logs', [
            'auditable_type' => Order::class,
            'auditable_id' => $order->id,
        ]);

        $this->assertDatabaseHas('audit_logs', [
            'auditable_type' => OrderLine::class,
            'auditable_id' => $orderLine->id,
        ]);
    }
}
