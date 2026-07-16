<?php

namespace Tests\Property;

use App\Models\AuditLog;
use App\Models\Creative;
use App\Models\Order;
use App\Models\OrderLine;
use App\Models\User;
use App\Services\AuditService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * Property-based tests for audit log completeness.
 *
 * Uses randomized inputs (100 iterations) to verify that for any change on an
 * auditable entity, the system creates an audit_log with correct polymorphic
 * references, user_id, timestamp, and diff values.
 *
 * Property 20: Audit log completeness
 *
 * **Validates: Requirements 11.1, 11.3, 11.6**
 */
class AuditCompletenessPropertyTest extends TestCase
{
    use RefreshDatabase;

    private AuditService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new AuditService();
    }

    // ─── Property 20a: Polymorphic auditable_type and auditable_id correctness ───

    /**
     * Property 20a: For any change on an auditable entity, the audit_log must have
     * auditable_type matching the model class and auditable_id matching the entity's primary key.
     *
     * For any randomly selected auditable model (Order, OrderLine, Creative) and any valid
     * event_type, the created audit_log entry must correctly store the polymorphic reference.
     *
     * **Validates: Requirements 11.1**
     */
    public function test_audit_log_has_correct_polymorphic_auditable_type_and_id(): void
    {
        $auditableModels = ['Order', 'OrderLine', 'Creative'];
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

        for ($i = 0; $i < 100; $i++) {
            $modelType = $auditableModels[array_rand($auditableModels)];
            $eventType = $eventTypes[array_rand($eventTypes)];

            $entity = match ($modelType) {
                'Order' => Order::factory()->create(),
                'OrderLine' => OrderLine::factory()->create(),
                'Creative' => Creative::factory()->create(),
            };

            $expectedClass = get_class($entity);
            $expectedId = $entity->getKey();

            $this->service->log($entity, $eventType);

            $auditLog = AuditLog::where('auditable_id', $expectedId)
                ->where('event_type', $eventType)
                ->latest('created_at')
                ->first();

            $this->assertNotNull(
                $auditLog,
                "Property 20a (iter {$i}): Audit log should be created for {$modelType} with event '{$eventType}'"
            );

            $this->assertEquals(
                $expectedClass,
                $auditLog->auditable_type,
                "Property 20a (iter {$i}): auditable_type should be '{$expectedClass}', got '{$auditLog->auditable_type}'"
            );

            $this->assertEquals(
                $expectedId,
                $auditLog->auditable_id,
                "Property 20a (iter {$i}): auditable_id should be '{$expectedId}', got '{$auditLog->auditable_id}'"
            );
        }
    }

    // ─── Property 20b: user_id recorded correctly ────────────────────────────

    /**
     * Property 20b: For any audit log entry, user_id must correctly reflect the user
     * who made the change — either the explicitly passed user_id or the authenticated user.
     *
     * For any randomly generated user and auditable entity, when user_id is passed explicitly
     * it must be stored; when authenticated, auth user_id must be resolved.
     *
     * **Validates: Requirements 11.6**
     */
    public function test_audit_log_records_user_id_correctly(): void
    {
        $auditableModels = ['Order', 'OrderLine', 'Creative'];

        for ($i = 0; $i < 100; $i++) {
            $modelType = $auditableModels[array_rand($auditableModels)];

            // Create entity without triggering observers to isolate AuditService testing
            $entity = match ($modelType) {
                'Order' => Order::withoutEvents(fn () => Order::factory()->create()),
                'OrderLine' => OrderLine::withoutEvents(fn () => OrderLine::factory()->create()),
                'Creative' => Creative::withoutEvents(fn () => Creative::factory()->create()),
            };

            $user = User::factory()->create();

            // Randomly choose between: explicit user_id, authenticated user, or no user
            $strategy = random_int(0, 2);

            switch ($strategy) {
                case 0:
                    // Explicit user_id
                    $this->service->log($entity, 'created', null, $user->id);
                    $expectedUserId = $user->id;
                    break;
                case 1:
                    // Authenticated user
                    $this->actingAs($user);
                    $this->service->log($entity, 'created');
                    $expectedUserId = $user->id;
                    auth()->logout();
                    break;
                case 2:
                    // No user
                    auth()->logout();
                    $this->service->log($entity, 'created');
                    $expectedUserId = null;
                    break;
            }

            $auditLog = AuditLog::where('auditable_id', $entity->getKey())
                ->where('auditable_type', get_class($entity))
                ->latest('created_at')
                ->first();

            $this->assertNotNull(
                $auditLog,
                "Property 20b (iter {$i}): Audit log should be created for {$modelType}"
            );

            $this->assertEquals(
                $expectedUserId,
                $auditLog->user_id,
                "Property 20b (iter {$i}): user_id should be " .
                ($expectedUserId ?? 'null') . ", got " . ($auditLog->user_id ?? 'null') .
                " (strategy={$strategy})"
            );
        }
    }

    // ─── Property 20c: created_at has valid timestamp ────────────────────────

    /**
     * Property 20c: For any audit log entry, created_at must be a valid timestamp
     * that reflects the time the change was recorded (within a reasonable tolerance).
     *
     * For any randomly generated auditable entity and event, the audit_log's created_at
     * must be a valid datetime that is close to the current time.
     *
     * **Validates: Requirements 11.6**
     */
    public function test_audit_log_has_valid_created_at_timestamp(): void
    {
        $auditableModels = ['Order', 'OrderLine', 'Creative'];

        for ($i = 0; $i < 100; $i++) {
            $modelType = $auditableModels[array_rand($auditableModels)];

            // Create entity without triggering observers to isolate AuditService testing
            $entity = match ($modelType) {
                'Order' => Order::withoutEvents(fn () => Order::factory()->create()),
                'OrderLine' => OrderLine::withoutEvents(fn () => OrderLine::factory()->create()),
                'Creative' => Creative::withoutEvents(fn () => Creative::factory()->create()),
            };

            // Set a randomized "now" to verify the service uses current time
            $randomTimestamp = Carbon::create(
                random_int(2024, 2026),
                random_int(1, 12),
                random_int(1, 28),
                random_int(0, 23),
                random_int(0, 59),
                random_int(0, 59)
            );
            Carbon::setTestNow($randomTimestamp);

            $this->service->log($entity, 'created');

            $auditLog = AuditLog::where('auditable_id', $entity->getKey())
                ->where('auditable_type', get_class($entity))
                ->latest('created_at')
                ->first();

            $this->assertNotNull(
                $auditLog,
                "Property 20c (iter {$i}): Audit log should be created for {$modelType}"
            );

            $this->assertNotNull(
                $auditLog->created_at,
                "Property 20c (iter {$i}): created_at must not be null"
            );

            $this->assertTrue(
                $auditLog->created_at instanceof \Illuminate\Support\Carbon ||
                $auditLog->created_at instanceof \Carbon\Carbon,
                "Property 20c (iter {$i}): created_at must be a valid Carbon datetime instance"
            );

            $this->assertEquals(
                $randomTimestamp->format('Y-m-d H:i:s'),
                $auditLog->created_at->format('Y-m-d H:i:s'),
                "Property 20c (iter {$i}): created_at should match the current time. " .
                "Expected {$randomTimestamp->format('Y-m-d H:i:s')}, got {$auditLog->created_at->format('Y-m-d H:i:s')}"
            );
        }

        Carbon::setTestNow();
    }

    // ─── Property 20d: diff correctness for field_modified events ─────────────

    /**
     * Property 20d: For any field_modified event, the audit_log diff must contain
     * old_value and new_value that correctly reflect the values before and after the change.
     *
     * For any randomly generated old/new value pair and field name on an auditable entity,
     * the diff stored must match exactly what was provided.
     *
     * **Validates: Requirements 11.3**
     */
    public function test_audit_log_diff_reflects_old_and_new_values_for_field_modified(): void
    {
        $auditableModels = ['Order', 'OrderLine', 'Creative'];
        $fieldNames = ['name', 'status', 'priority_tier', 'target_spots', 'delivery_pace', 'weight', 'advertiser_name'];
        $sampleValues = [
            'string' => ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Campaign A', 'Campaign B'],
            'numeric' => [0, 1, 5, 10, 50, 100, 500, 1000, 5000, 9999],
            'status' => ['draft', 'active', 'paused', 'completed', 'cancelled'],
        ];

        for ($i = 0; $i < 100; $i++) {
            $modelType = $auditableModels[array_rand($auditableModels)];
            $entity = match ($modelType) {
                'Order' => Order::factory()->create(),
                'OrderLine' => OrderLine::factory()->create(),
                'Creative' => Creative::factory()->create(),
            };

            $field = $fieldNames[array_rand($fieldNames)];

            // Generate random old_value and new_value ensuring they are different
            $valueType = array_rand($sampleValues);
            $pool = $sampleValues[$valueType];
            $oldValue = $pool[array_rand($pool)];
            do {
                $newValue = $pool[array_rand($pool)];
            } while ($newValue === $oldValue && count($pool) > 1);

            $diff = [
                'field' => $field,
                'old_value' => $oldValue,
                'new_value' => $newValue,
            ];

            $this->service->log($entity, 'field_modified', $diff);

            $auditLog = AuditLog::where('auditable_id', $entity->getKey())
                ->where('auditable_type', get_class($entity))
                ->where('event_type', 'field_modified')
                ->latest('created_at')
                ->first();

            $this->assertNotNull(
                $auditLog,
                "Property 20d (iter {$i}): Audit log should be created for field_modified on {$modelType}"
            );

            $this->assertNotNull(
                $auditLog->diff,
                "Property 20d (iter {$i}): diff must not be null for field_modified events"
            );

            $this->assertArrayHasKey(
                'field',
                $auditLog->diff,
                "Property 20d (iter {$i}): diff must contain 'field' key"
            );

            $this->assertArrayHasKey(
                'old_value',
                $auditLog->diff,
                "Property 20d (iter {$i}): diff must contain 'old_value' key"
            );

            $this->assertArrayHasKey(
                'new_value',
                $auditLog->diff,
                "Property 20d (iter {$i}): diff must contain 'new_value' key"
            );

            $this->assertEquals(
                $field,
                $auditLog->diff['field'],
                "Property 20d (iter {$i}): diff['field'] should be '{$field}', got '{$auditLog->diff['field']}'"
            );

            $this->assertEquals(
                $oldValue,
                $auditLog->diff['old_value'],
                "Property 20d (iter {$i}): diff['old_value'] should be " . json_encode($oldValue) .
                ", got " . json_encode($auditLog->diff['old_value'])
            );

            $this->assertEquals(
                $newValue,
                $auditLog->diff['new_value'],
                "Property 20d (iter {$i}): diff['new_value'] should be " . json_encode($newValue) .
                ", got " . json_encode($auditLog->diff['new_value'])
            );
        }
    }
}
