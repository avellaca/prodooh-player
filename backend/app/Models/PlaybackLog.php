<?php

namespace App\Models;

use App\Models\Traits\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class PlaybackLog extends Model
{
    use BelongsToTenant, HasFactory, HasUuids;

    /**
     * Indicates that the model's ID is not auto-incrementing.
     */
    public $incrementing = false;

    /**
     * The data type of the primary key.
     */
    protected $keyType = 'string';

    /**
     * The attributes that are mass assignable.
     *
     * @var list<string>
     */
    protected $fillable = [
        'screen_id',
        'tenant_id',
        'content_id',
        'source',
        'started_at',
        'ended_at',
        'duration_seconds',
        'result',
        'failure_reason',
        'synced_at',
    ];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'started_at' => 'datetime',
            'ended_at' => 'datetime',
            'synced_at' => 'datetime',
        ];
    }

    /**
     * Get the screen this log belongs to.
     */
    public function screen()
    {
        return $this->belongsTo(Screen::class);
    }
}
